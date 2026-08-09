import { describe, expect, it, vi } from "vitest";
import { getReportHandler } from "./get-report";

const core = vi.hoisted(() => vi.fn());
const resolveBoardIds = vi.hoisted(() => vi.fn());
vi.mock("@/lib/reports/queries", () => ({
  getReportCore: core,
  resolveReportBoardIdsCore: resolveBoardIds,
}));

/** A client that answers ONLY the batched `boards` readability probe,
 *  asserting the table, projection and filter it is asked for — a probe
 *  against the wrong table or column fails loudly instead of silently
 *  returning undefined. RLS is what filters `in (…)` in production, so the
 *  fake filters the requested ids by `readable` to model exactly that. */
function boardProbeClient(readable: string[], dbError?: string) {
  const inFilter = vi.fn(async (column: string, values: string[]) => {
    expect(column).toBe("id");
    if (dbError) return { data: null, error: { message: dbError } };
    return {
      data: values.filter((v) => readable.includes(v)).map((id) => ({ id })),
      error: null,
    };
  });
  const from = vi.fn((table: string) => {
    expect(table).toBe("boards");
    return {
      select: (columns: string) => {
        expect(columns).toBe("id");
        return { in: inFilter };
      },
    };
  });
  return { client: { from } as never, from, inFilter };
}

/** A client that fails the test if ANY query is issued — used where the
 *  handler must answer without touching the database. */
function noQueryClient() {
  const from = vi.fn(() => {
    throw new Error("no query expected");
  });
  return { client: { from } as never, from };
}

const SECRET_REPORT = {
  id: "r1",
  orgId: "o1",
  scope: "boards",
  boardId: null,
  portfolioId: null,
  name: "Acquisition pipeline",
  updatedAt: "2026-01-05T10:00:00Z",
  config: {
    v: 1,
    title: "Status Report",
    blocks: [
      { type: "kpis", enabled: true, options: {} },
      {
        type: "chart",
        enabled: true,
        options: {
          variant: "donut",
          source: "status",
          columnId: null,
          title: "Deals by stage",
          maxCategories: 6,
        },
      },
    ],
  },
};

function reset() {
  core.mockReset();
  resolveBoardIds.mockReset();
}

describe("getReportHandler", () => {
  it("returns the report's block structure, folding an unset chart title to null", async () => {
    reset();
    core.mockResolvedValue({
      id: "r1",
      orgId: "o1",
      scope: "board",
      boardId: "b1",
      portfolioId: null,
      name: "Weekly status",
      updatedAt: "2026-01-05T10:00:00Z",
      config: {
        v: 1,
        title: "Status Report",
        blocks: [
          { type: "kpis", enabled: true, options: {} },
          {
            type: "chart",
            enabled: true,
            options: {
              variant: "donut",
              source: "status",
              columnId: null,
              title: "By status",
              maxCategories: 6,
            },
          },
          {
            type: "chart",
            enabled: true,
            options: {
              variant: "bars",
              source: "board_group",
              columnId: null,
              title: "",
              maxCategories: 6,
            },
          },
          {
            type: "table",
            enabled: true,
            options: { orientation: "landscape", columnIds: null },
          },
        ],
      },
    });
    resolveBoardIds.mockResolvedValue(["b1"]);
    const { client, inFilter } = boardProbeClient(["b1"]);
    const getClient = vi.fn(async () => client);

    const result = await getReportHandler(getClient, { reportId: "r1" });

    expect(getClient).toHaveBeenCalledTimes(1);
    expect(core).toHaveBeenCalledTimes(1);
    // Exactly one board readability probe — never one per block.
    expect(inFilter).toHaveBeenCalledTimes(1);
    expect(JSON.parse(result.content[0].text)).toEqual({
      id: "r1",
      name: "Weekly status",
      scope: "board",
      boardId: "b1",
      boardIds: ["b1"],
      updatedAt: "2026-01-05T10:00:00Z",
      blocks: [
        { type: "kpis", title: null },
        { type: "chart", title: "By status" },
        // An explicit but empty options.title ("derive at render time") folds
        // to null too — a bare "" would silently look like a real title.
        { type: "chart", title: null },
        { type: "table", title: null },
      ],
    });
  });

  it("returns a multi-board report when the caller can read even ONE of its boards, in a single probe", async () => {
    reset();
    core.mockResolvedValue({ ...SECRET_REPORT, name: "Q1 roll-up" });
    resolveBoardIds.mockResolvedValue(["b1", "b2", "b3"]);
    // Only b2 is open to this caller — that is enough to read the roll-up.
    const { client, from, inFilter } = boardProbeClient(["b2"]);
    const getClient = vi.fn(async () => client);

    const result = await getReportHandler(getClient, { reportId: "r1" });

    expect(getClient).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledTimes(1);
    // ONE set-based probe for all three boards — never one query per board.
    expect(inFilter).toHaveBeenCalledTimes(1);
    expect(inFilter).toHaveBeenCalledWith("id", ["b1", "b2", "b3"]);
    expect(result.isError).toBeUndefined();
    const payload = JSON.parse(result.content[0].text);
    expect(payload.name).toBe("Q1 roll-up");
    expect(payload.scope).toBe("boards");
    // The home-board pointer is null for a roll-up; `boardIds` is the answer.
    expect(payload.boardId).toBeNull();
    expect(payload.boardIds).toEqual(["b1", "b2", "b3"]);
  });

  it("errors when NONE of a multi-board report's boards is readable, leaking no structure and no existence", async () => {
    // `reports` RLS is only `is_org_member(org_id)`, so the row IS returned to
    // an org member who is on none of the (private) boards. Only the board
    // precheck stops the name/timestamp/block structure from going out.
    reset();
    core.mockResolvedValue(SECRET_REPORT);
    resolveBoardIds.mockResolvedValue(["b1", "b2", "b3"]);
    const { client, from, inFilter } = boardProbeClient([]);
    const getClient = vi.fn(async () => client);

    const result = await getReportHandler(getClient, { reportId: "r1" });

    expect(getClient).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith("boards");
    expect(inFilter).toHaveBeenCalledTimes(1);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("Report r1 not found.");
    // Nothing from the row survives into the response: not the name, not the
    // chart title, not the block types, not the board ids.
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("Acquisition pipeline");
    expect(serialized).not.toContain("Deals by stage");
    expect(serialized).not.toContain("kpis");
    expect(serialized).not.toContain("b1");
  });

  it("refuses an unreadable report with the byte-identical message a missing report gets", async () => {
    reset();
    core.mockResolvedValue(SECRET_REPORT);
    resolveBoardIds.mockResolvedValue(["b1"]);
    const unreadable = await getReportHandler(
      vi.fn(async () => boardProbeClient([]).client),
      { reportId: "r1" },
    );

    reset();
    core.mockResolvedValue(null);
    const missing = await getReportHandler(
      vi.fn(async () => ({}) as never),
      {
        reportId: "r1",
      },
    );

    // Byte-identical, not merely "similar": the refusal must not disclose that
    // the report exists.
    expect(unreadable.content[0].text).toBe(missing.content[0].text);
    expect(unreadable.isError).toBe(missing.isError);
  });

  it("lets any org member read a template, with no board probe at all", async () => {
    // A template is config only — no bound boards, hence no board data to
    // leak, hence nothing to gate on. A caller on zero boards may read it.
    reset();
    core.mockResolvedValue({
      id: "t1",
      orgId: "o1",
      scope: "template",
      boardId: null,
      portfolioId: null,
      name: "Monthly template",
      updatedAt: "2026-01-05T10:00:00Z",
      config: {
        v: 1,
        title: "Status Report",
        blocks: [{ type: "cover", enabled: true, options: {} }],
      },
    });
    const { client, from } = noQueryClient();
    const getClient = vi.fn(async () => client);

    const result = await getReportHandler(getClient, { reportId: "t1" });

    expect(result.isError).toBeUndefined();
    // No readability probe — and no membership resolve either: a template's
    // board list is empty by construction, so neither read is issued.
    expect(from).not.toHaveBeenCalled();
    expect(resolveBoardIds).not.toHaveBeenCalled();
    expect(JSON.parse(result.content[0].text)).toEqual({
      id: "t1",
      name: "Monthly template",
      scope: "template",
      boardId: null,
      boardIds: [],
      updatedAt: "2026-01-05T10:00:00Z",
      blocks: [{ type: "cover", title: null }],
    });
  });

  it("reports the portfolio a portfolio-scoped roll-up follows", async () => {
    reset();
    core.mockResolvedValue({
      id: "r9",
      orgId: "o1",
      scope: "portfolio",
      boardId: null,
      portfolioId: "p1",
      name: "Portfolio roll-up",
      updatedAt: "2026-01-05T10:00:00Z",
      config: {
        v: 1,
        title: "Status Report",
        blocks: [{ type: "kpis", enabled: true, options: {} }],
      },
    });
    resolveBoardIds.mockResolvedValue(["b1", "b2"]);
    const { client, inFilter } = boardProbeClient(["b1"]);
    const getClient = vi.fn(async () => client);

    const result = await getReportHandler(getClient, { reportId: "r9" });

    expect(inFilter).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(result.content[0].text);
    expect(payload.scope).toBe("portfolio");
    expect(payload.portfolioId).toBe("p1");
    expect(payload.boardIds).toEqual(["b1", "b2"]);
  });

  it("errors when the report is not visible", async () => {
    reset();
    core.mockResolvedValue(null);
    const getClient = vi.fn(async () => ({}) as never);

    const result = await getReportHandler(getClient, { reportId: "missing" });

    expect(getClient).toHaveBeenCalledTimes(1);
    expect(core).toHaveBeenCalledTimes(1);
    // Not even the membership resolve runs for a row that is not visible.
    expect(resolveBoardIds).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("missing");
  });

  it("surfaces a failed readability probe as the real error, never as not-found", async () => {
    // A DB outage must not be read as "you cannot see this board" — that would
    // turn every blip into a silent, unexplained not-found.
    reset();
    core.mockResolvedValue(SECRET_REPORT);
    resolveBoardIds.mockResolvedValue(["b1", "b2"]);
    const { client } = boardProbeClient([], "connection reset");
    const getClient = vi.fn(async () => client);

    const result = await getReportHandler(getClient, { reportId: "r1" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("connection reset");
    expect(result.content[0].text).not.toBe("Report r1 not found.");
  });

  it("surfaces a core failure as an error result", async () => {
    reset();
    core.mockRejectedValue(new Error("db unavailable"));
    const getClient = vi.fn(async () => ({}) as never);

    const result = await getReportHandler(getClient, { reportId: "r1" });

    expect(getClient).toHaveBeenCalledTimes(1);
    expect(core).toHaveBeenCalledTimes(1);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("db unavailable");
  });
});
