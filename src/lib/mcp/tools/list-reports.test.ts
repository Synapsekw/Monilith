import { describe, expect, it, vi } from "vitest";
import { listReportsHandler } from "./list-reports";

const core = vi.hoisted(() => vi.fn());
const resolveBoardIds = vi.hoisted(() => vi.fn());
vi.mock("@/lib/reports/queries", () => ({
  REPORTS_LIMIT: 100,
  listReportsForBoardCore: core,
  resolveReportBoardIdsCore: resolveBoardIds,
}));

/** A client that answers ONLY the `boards` readability probe, asserting the
 *  table, projection and filter it is asked for. */
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

/** A scope-"board" report bound to b1 alone. */
function boardReport(id: string, name: string, updatedAt: string) {
  return {
    id,
    orgId: "o1",
    scope: "board",
    boardId: "b1",
    portfolioId: null,
    name,
    updatedAt,
    config: {
      v: 1,
      title: "Status Report",
      blocks: [{ type: "cover", enabled: true, options: {} }],
    },
  };
}

function reset() {
  core.mockReset();
  resolveBoardIds.mockReset();
}

describe("listReportsHandler", () => {
  it("refuses a board the caller cannot read, without reaching the core", async () => {
    // `reports` RLS is only `is_org_member(org_id)` while `boards` read
    // additionally requires creator-or-board-member. Without this precheck an
    // org member could enumerate every report name and id on a private board.
    reset();
    const { client, from, maybeSingle } = boardProbeClient(false);
    const getClient = vi.fn(async () => client);

    const result = await listReportsHandler(getClient, { boardId: "b1" });

    expect(getClient).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith("boards");
    expect(maybeSingle).toHaveBeenCalledTimes(1);
    // The reports read never happens at all — nothing to leak.
    expect(core).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    // Same wording list_items uses, so "unreadable" and "nonexistent" are
    // indistinguishable to the caller.
    expect(result.content[0].text).toBe("Board not found.");
  });

  it("returns report summaries for a board", async () => {
    reset();
    core.mockResolvedValue([
      {
        ...boardReport("r1", "Weekly status", "2026-01-05T10:00:00Z"),
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
                title: "",
                maxCategories: 6,
              },
            },
          ],
        },
      },
      boardReport("r2", "Exec summary", "2026-01-04T09:00:00Z"),
    ]);
    const { client, maybeSingle } = boardProbeClient(true);
    const getClient = vi.fn(async () => client);

    const result = await listReportsHandler(getClient, { boardId: "b1" });

    expect(getClient).toHaveBeenCalledTimes(1);
    expect(core).toHaveBeenCalledTimes(1);
    // Exactly one board probe — never one per report.
    expect(maybeSingle).toHaveBeenCalledTimes(1);
    // scope "board" spans exactly one board by schema constraint, so the
    // listing costs no membership read at all.
    expect(resolveBoardIds).not.toHaveBeenCalled();
    expect(JSON.parse(result.content[0].text)).toEqual([
      {
        id: "r1",
        name: "Weekly status",
        scope: "board",
        boardId: "b1",
        boardCount: 1,
        updatedAt: "2026-01-05T10:00:00Z",
        blockCount: 2,
      },
      {
        id: "r2",
        name: "Exec summary",
        scope: "board",
        boardId: "b1",
        boardCount: 1,
        updatedAt: "2026-01-04T09:00:00Z",
        blockCount: 1,
      },
    ]);
  });

  it("surfaces a multi-board roll-up that includes the queried board", async () => {
    // Membership is `report_boards`, not `reports.board_id`: a roll-up whose
    // home board is null still renders b1, so it belongs in b1's listing.
    reset();
    core.mockResolvedValue([
      {
        id: "r7",
        orgId: "o1",
        scope: "boards",
        boardId: null,
        portfolioId: null,
        name: "Q1 roll-up",
        updatedAt: "2026-01-06T10:00:00Z",
        config: {
          v: 1,
          title: "Status Report",
          blocks: [
            { type: "cover", enabled: true, options: {} },
            { type: "kpis", enabled: true, options: {} },
          ],
        },
      },
      boardReport("r1", "Weekly status", "2026-01-05T10:00:00Z"),
    ]);
    resolveBoardIds.mockResolvedValue(["b1", "b2", "b3"]);
    const { client, maybeSingle } = boardProbeClient(true);
    const getClient = vi.fn(async () => client);

    const result = await listReportsHandler(getClient, { boardId: "b1" });

    // Still exactly one board readability probe — the queried board, gated
    // before any report read; the roll-up's own membership is re-gated by
    // get_report, not enumerated here.
    expect(maybeSingle).toHaveBeenCalledTimes(1);
    // Only the roll-up needs a membership read; the scope-"board" row does not.
    expect(resolveBoardIds).toHaveBeenCalledTimes(1);
    expect(JSON.parse(result.content[0].text)).toEqual([
      {
        id: "r7",
        name: "Q1 roll-up",
        scope: "boards",
        boardId: null,
        boardCount: 3,
        updatedAt: "2026-01-06T10:00:00Z",
        blockCount: 2,
      },
      {
        id: "r1",
        name: "Weekly status",
        scope: "board",
        boardId: "b1",
        boardCount: 1,
        updatedAt: "2026-01-05T10:00:00Z",
        blockCount: 1,
      },
    ]);
  });

  it("counts a portfolio roll-up's auto-followed boards", async () => {
    reset();
    core.mockResolvedValue([
      {
        id: "r9",
        orgId: "o1",
        scope: "portfolio",
        boardId: null,
        portfolioId: "p1",
        name: "Portfolio roll-up",
        updatedAt: "2026-01-07T10:00:00Z",
        config: {
          v: 1,
          title: "Status Report",
          blocks: [{ type: "kpis", enabled: true, options: {} }],
        },
      },
    ]);
    resolveBoardIds.mockResolvedValue(["b1", "b2"]);
    const { client } = boardProbeClient(true);
    const getClient = vi.fn(async () => client);

    const result = await listReportsHandler(getClient, { boardId: "b1" });

    expect(resolveBoardIds).toHaveBeenCalledTimes(1);
    const summaries = JSON.parse(result.content[0].text);
    expect(summaries[0].scope).toBe("portfolio");
    expect(summaries[0].boardCount).toBe(2);
    expect(summaries[0].boardId).toBeNull();
  });

  it("surfaces a core failure as an error result without a partial call", async () => {
    reset();
    core.mockRejectedValue(new Error("db unavailable"));
    const { client } = boardProbeClient(true);
    const getClient = vi.fn(async () => client);

    const result = await listReportsHandler(getClient, { boardId: "b1" });

    expect(getClient).toHaveBeenCalledTimes(1);
    expect(core).toHaveBeenCalledTimes(1);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("db unavailable");
  });
});
