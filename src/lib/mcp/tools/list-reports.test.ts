import { describe, expect, it, vi } from "vitest";
import { listReportsHandler } from "./list-reports";

const core = vi.hoisted(() => vi.fn());
vi.mock("@/lib/reports/queries", () => ({
  REPORTS_LIMIT: 100,
  listReportsCore: core,
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

describe("listReportsHandler", () => {
  it("refuses a board the caller cannot read, without reaching the core", async () => {
    // `reports` RLS is only `is_org_member(org_id)` while `boards` read
    // additionally requires creator-or-board-member. Without this precheck an
    // org member could enumerate every report name and id on a private board.
    core.mockReset();
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
    core.mockReset();
    core.mockResolvedValue([
      {
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
                title: "",
                maxCategories: 6,
              },
            },
          ],
        },
      },
      {
        id: "r2",
        orgId: "o1",
        boardId: "b1",
        name: "Exec summary",
        updatedAt: "2026-01-04T09:00:00Z",
        config: {
          v: 1,
          title: "Status Report",
          blocks: [{ type: "cover", enabled: true, options: {} }],
        },
      },
    ]);
    const { client, maybeSingle } = boardProbeClient(true);
    const getClient = vi.fn(async () => client);

    const result = await listReportsHandler(getClient, { boardId: "b1" });

    expect(getClient).toHaveBeenCalledTimes(1);
    expect(core).toHaveBeenCalledTimes(1);
    // Exactly one board probe — never one per report.
    expect(maybeSingle).toHaveBeenCalledTimes(1);
    expect(JSON.parse(result.content[0].text)).toEqual([
      {
        id: "r1",
        name: "Weekly status",
        boardId: "b1",
        updatedAt: "2026-01-05T10:00:00Z",
        blockCount: 2,
      },
      {
        id: "r2",
        name: "Exec summary",
        boardId: "b1",
        updatedAt: "2026-01-04T09:00:00Z",
        blockCount: 1,
      },
    ]);
  });

  it("surfaces a core failure as an error result without a partial call", async () => {
    core.mockReset();
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
