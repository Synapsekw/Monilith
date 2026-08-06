import { describe, expect, it, vi } from "vitest";
import { getTimeSummaryHandler } from "./get-time-summary";

vi.mock("@/lib/time/queries", () => ({
  TIME_ALLOCATIONS_LIMIT: 1000,
  TIME_RANGE_MAX_DAYS: 92,
  listTimeAllocationsCore: vi.fn(async () => [
    {
      date: "2026-01-01",
      itemId: "i1",
      itemName: "API",
      boardId: "b1",
      category: null,
      secs: 3600,
      note: null,
    },
    {
      date: "2026-01-02",
      itemId: "i1",
      itemName: "API",
      boardId: "b1",
      category: null,
      secs: 1800,
      note: null,
    },
  ]),
}));

describe("getTimeSummaryHandler", () => {
  it("folds rows into totals for the requested grouping", async () => {
    const getClient = vi.fn(async () => ({}) as never);
    const result = await getTimeSummaryHandler(getClient, "u1", {
      from: "2026-01-01",
      to: "2026-01-31",
      groupBy: "item",
    });

    expect(getClient).toHaveBeenCalledTimes(1);
    expect(JSON.parse(result.content[0].text)).toEqual([
      { key: "i1", label: "API", totalSecs: 5400 },
    ]);
  });

  it("rejects an over-long range", async () => {
    const result = await getTimeSummaryHandler(
      async () => ({}) as never,
      "u1",
      { from: "2026-01-01", to: "2026-12-31", groupBy: "day" },
    );
    expect(result.isError).toBe(true);
  });
});
