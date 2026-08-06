import { describe, expect, it } from "vitest";
import { summarizeAllocations } from "./summary";
import type { TimeAllocationFlat } from "./queries";

const ROWS: TimeAllocationFlat[] = [
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
    date: "2026-01-01",
    itemId: "i1",
    itemName: "API",
    boardId: "b1",
    category: null,
    secs: 1800,
    note: null,
  },
  {
    date: "2026-01-02",
    itemId: null,
    itemName: null,
    boardId: null,
    category: "Admin",
    secs: 900,
    note: null,
  },
];

// A second category row, so "the category rows the item grouping dropped" is a
// SUM of more than one value — a single dropped row can't tell an accumulator
// apart from a last-write-wins assignment.
const MIXED: TimeAllocationFlat[] = [
  ...ROWS,
  {
    date: "2026-01-03",
    itemId: null,
    itemName: null,
    boardId: null,
    category: "Recruiting",
    secs: 1200,
    note: null,
  },
];

describe("summarizeAllocations", () => {
  it("groups by item and sums seconds, reporting the category time it excluded", () => {
    // ROWS holds 5400s on item i1 and 900s under "Admin". Returning only the
    // buckets would let an agent report "you logged 1h30" for a window that
    // actually holds 1h45.
    expect(summarizeAllocations(ROWS, "item")).toEqual({
      buckets: [{ key: "i1", label: "API", totalSecs: 5400 }],
      ungroupedSecs: 900,
    });
  });

  it("groups by category, reporting the item time it excluded", () => {
    expect(summarizeAllocations(ROWS, "category")).toEqual({
      buckets: [{ key: "Admin", label: "Admin", totalSecs: 900 }],
      ungroupedSecs: 5400,
    });
  });

  it("groups by day, sorted ascending, excluding nothing", () => {
    expect(summarizeAllocations(ROWS, "day")).toEqual({
      buckets: [
        { key: "2026-01-01", label: "2026-01-01", totalSecs: 5400 },
        { key: "2026-01-02", label: "2026-01-02", totalSecs: 900 },
      ],
      // Every row carries a date, so `day` never drops any.
      ungroupedSecs: 0,
    });
  });

  it("accumulates ungroupedSecs across MULTIPLE excluded rows", () => {
    const byItem = summarizeAllocations(MIXED, "item");
    expect(byItem.buckets).toEqual([
      { key: "i1", label: "API", totalSecs: 5400 },
    ]);
    // 900 (Admin) + 1200 (Recruiting) — summed, not overwritten.
    expect(byItem.ungroupedSecs).toBe(2100);

    // The two dimensions partition the window: buckets + ungrouped is the
    // whole total, whichever way it is sliced.
    const total = MIXED.reduce((n, r) => n + r.secs, 0);
    const bucketed = byItem.buckets.reduce((n, b) => n + b.totalSecs, 0);
    expect(bucketed + byItem.ungroupedSecs).toBe(total);

    const byCategory = summarizeAllocations(MIXED, "category");
    expect(byCategory.buckets).toEqual([
      { key: "Recruiting", label: "Recruiting", totalSecs: 1200 },
      { key: "Admin", label: "Admin", totalSecs: 900 },
    ]);
    expect(byCategory.ungroupedSecs).toBe(5400);

    const byDay = summarizeAllocations(MIXED, "day");
    expect(byDay.ungroupedSecs).toBe(0);
    expect(byDay.buckets.reduce((n, b) => n + b.totalSecs, 0)).toBe(total);
  });
});
