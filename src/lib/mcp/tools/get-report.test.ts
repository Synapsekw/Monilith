import { describe, expect, it, vi } from "vitest";
import { getReportHandler } from "./get-report";

const core = vi.hoisted(() => vi.fn());
vi.mock("@/lib/reports/queries", () => ({ getReportCore: core }));

/** A client that answers ONLY the `boards` readability probe, asserting the
 *  table, projection and filter it is asked for — a probe against the wrong
 *  table or column fails loudly instead of silently returning undefined. */
function boardProbeClient(readable: boolean, boardId = "b1") {
  const maybeSingle = vi.fn(async () => ({
    data: readable ? { id: boardId } : null,
    error: null,
  }));
  const from = vi.fn((table: string) => {
    expect(table).toBe("boards");
    return {
      select: (columns: string) => {
        expect(columns).toBe("id");
        return {
          eq: (column: string, value: string) => {
            expect(column).toBe("id");
            expect(value).toBe(boardId);
            return { maybeSingle };
          },
        };
      },
    };
  });
  return { client: { from } as never, from, maybeSingle };
}

const SECRET_REPORT = {
  id: "r1",
  orgId: "o1",
  boardId: "b1",
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

describe("getReportHandler", () => {
  it("returns the report's block structure, folding an unset chart title to null", async () => {
    core.mockResolvedValue({
      id: "r1",
      orgId: "o1",
      boardId: "b1",
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
    const { client, maybeSingle } = boardProbeClient(true);
    const getClient = vi.fn(async () => client);

    const result = await getReportHandler(getClient, { reportId: "r1" });

    expect(getClient).toHaveBeenCalledTimes(1);
    expect(core).toHaveBeenCalledTimes(1);
    // Exactly one board readability probe — never one per block.
    expect(maybeSingle).toHaveBeenCalledTimes(1);
    expect(JSON.parse(result.content[0].text)).toEqual({
      id: "r1",
      name: "Weekly status",
      boardId: "b1",
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

  it("errors when the report's board is unreadable, leaking no structure and no existence", async () => {
    // `reports` RLS is only `is_org_member(org_id)`, so the row IS returned to
    // an org member who is not on the (private) board. Only the board precheck
    // stops the name/timestamp/block structure from going out.
    core.mockReset();
    core.mockResolvedValue(SECRET_REPORT);
    const { client, from, maybeSingle } = boardProbeClient(false);
    const getClient = vi.fn(async () => client);

    const result = await getReportHandler(getClient, { reportId: "r1" });

    expect(getClient).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith("boards");
    expect(maybeSingle).toHaveBeenCalledTimes(1);
    expect(result.isError).toBe(true);
    // Byte-identical to a genuinely missing report — the refusal itself must
    // not disclose that the report exists.
    expect(result.content[0].text).toBe("Report r1 not found.");
    // Nothing from the row survives into the response: not the name, not the
    // chart title, not the block types.
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("Acquisition pipeline");
    expect(serialized).not.toContain("Deals by stage");
    expect(serialized).not.toContain("kpis");
  });

  it("errors when the report is not visible", async () => {
    core.mockReset();
    core.mockResolvedValue(null);
    const getClient = vi.fn(async () => ({}) as never);

    const result = await getReportHandler(getClient, { reportId: "missing" });

    expect(getClient).toHaveBeenCalledTimes(1);
    expect(core).toHaveBeenCalledTimes(1);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("missing");
  });

  it("surfaces a core failure as an error result", async () => {
    core.mockReset();
    core.mockRejectedValue(new Error("db unavailable"));
    const getClient = vi.fn(async () => ({}) as never);

    const result = await getReportHandler(getClient, { reportId: "r1" });

    expect(getClient).toHaveBeenCalledTimes(1);
    expect(core).toHaveBeenCalledTimes(1);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("db unavailable");
  });
});
