import { describe, expect, it, vi } from "vitest";
import { listReportsHandler } from "./list-reports";

const core = vi.hoisted(() => vi.fn());
vi.mock("@/lib/reports/queries", () => ({
  REPORTS_LIMIT: 100,
  listReportsCore: core,
}));

describe("listReportsHandler", () => {
  it("returns report summaries for a board", async () => {
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
    const getClient = vi.fn(async () => ({}) as never);

    const result = await listReportsHandler(getClient, { boardId: "b1" });

    expect(getClient).toHaveBeenCalledTimes(1);
    expect(core).toHaveBeenCalledTimes(1);
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
    const getClient = vi.fn(async () => ({}) as never);

    const result = await listReportsHandler(getClient, { boardId: "b1" });

    expect(getClient).toHaveBeenCalledTimes(1);
    expect(core).toHaveBeenCalledTimes(1);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("db unavailable");
  });
});
