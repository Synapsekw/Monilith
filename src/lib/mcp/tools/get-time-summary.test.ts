import { describe, expect, it, vi } from "vitest";
import { getTimeSummaryHandler } from "./get-time-summary";
import { listTimeAllocationsCore } from "@/lib/time/queries";

vi.mock("@/lib/time/queries", () => ({
  TIME_ALLOCATIONS_LIMIT: 1000,
  TIME_RANGE_MAX_DAYS: 92,
  listTimeAllocationsCore: vi.fn(async () => ({
    rows: [
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
    ],
    truncated: false,
  })),
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

  it("rejects an over-long range without touching the client", async () => {
    const getClient = vi.fn(async () => ({}) as never);
    const result = await getTimeSummaryHandler(getClient, "u1", {
      from: "2026-01-01",
      to: "2026-12-31",
      groupBy: "day",
    });

    expect(result.isError).toBe(true);
    expect(getClient).not.toHaveBeenCalled();
  });

  it("errors, naming the cap, when the core reports truncation", async () => {
    vi.mocked(listTimeAllocationsCore).mockResolvedValueOnce({
      rows: [],
      truncated: true,
    });

    const getClient = vi.fn(async () => ({}) as never);
    const result = await getTimeSummaryHandler(getClient, "u1", {
      from: "2026-01-01",
      to: "2026-01-31",
      groupBy: "item",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("1000");
  });
});
