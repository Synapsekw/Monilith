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

describe("summarizeAllocations", () => {
  it("groups by item and sums seconds", () => {
    expect(summarizeAllocations(ROWS, "item")).toEqual([
      { key: "i1", label: "API", totalSecs: 5400 },
    ]);
  });

  it("groups by category", () => {
    expect(summarizeAllocations(ROWS, "category")).toEqual([
      { key: "Admin", label: "Admin", totalSecs: 900 },
    ]);
  });

  it("groups by day, sorted ascending", () => {
    expect(summarizeAllocations(ROWS, "day")).toEqual([
      { key: "2026-01-01", label: "2026-01-01", totalSecs: 5400 },
      { key: "2026-01-02", label: "2026-01-02", totalSecs: 900 },
    ]);
  });
});
