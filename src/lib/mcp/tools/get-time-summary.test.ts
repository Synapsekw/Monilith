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
      // Category-logged time in the SAME window: an allocation carries either
      // an item or a category, never both, so `groupBy: "item"` excludes this
      // row entirely. It must still be accounted for.
      {
        date: "2026-01-03",
        itemId: null,
        itemName: null,
        boardId: null,
        category: "Admin",
        secs: 3600,
        note: null,
      },
    ],
    truncated: false,
  })),
}));

describe("getTimeSummaryHandler", () => {
  it("folds rows into totals AND surfaces the time the grouping excluded", async () => {
    const getClient = vi.fn(async () => ({}) as never);
    const result = await getTimeSummaryHandler(getClient, "u1", {
      from: "2026-01-01",
      to: "2026-01-31",
      groupBy: "item",
    });

    expect(getClient).toHaveBeenCalledTimes(1);
    // A bare bucket array here would let the agent report "you logged 1h30"
    // for a window that actually holds 2h30 — the same confidently-partial
    // total the row-cap guard below refuses to produce.
    expect(JSON.parse(result.content[0].text)).toEqual({
      buckets: [{ key: "i1", label: "API", totalSecs: 5400 }],
      ungroupedSecs: 3600,
    });
  });

  it("reports zero excluded time when the grouping excludes nothing", async () => {
    const getClient = vi.fn(async () => ({}) as never);
    const result = await getTimeSummaryHandler(getClient, "u1", {
      from: "2026-01-01",
      to: "2026-01-31",
      groupBy: "day",
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.ungroupedSecs).toBe(0);
    expect(
      parsed.buckets.reduce(
        (n: number, b: { totalSecs: number }) => n + b.totalSecs,
        0,
      ),
    ).toBe(9000);
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
