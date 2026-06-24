import { describe, it, expect } from "vitest";
import {
  buildGanttRows,
  detectViolations,
  onBarMoved,
  onBarResized,
  timelineDayCount,
} from "@/lib/boards/gantt";

const items = [
  { id: "i1", name: "A" },
  { id: "i2", name: "B" },
  { id: "i3", name: "C" },
] as never;
const cells = [
  {
    item_id: "i1",
    column_id: "d1",
    value: { date: "2026-06-02", end: "2026-06-04" },
  },
  { item_id: "i2", column_id: "d1", value: { date: "2026-06-03" } }, // milestone
  // i3 unscheduled
] as never;

const twoColCells = [
  { item_id: "i1", column_id: "s1", value: { date: "2026-06-02" } },
  { item_id: "i1", column_id: "e1", value: { date: "2026-06-06" } },
] as never;

describe("buildGanttRows", () => {
  const { rows } = buildGanttRows(
    items,
    cells,
    "d1",
    null,
    "2026-06-01",
    30,
    "month",
  );
  it("computes start column + span (1-based day offset)", () => {
    const a = rows.find((r) => r.itemId === "i1")!;
    expect(a).toMatchObject({
      startCol: 1,
      spanCols: 3,
      isMilestone: false,
      scheduled: true,
    });
  });
  it("marks a single-day item as a milestone", () => {
    expect(rows.find((r) => r.itemId === "i2")!.isMilestone).toBe(true);
  });
  it("marks date-less items unscheduled", () => {
    expect(rows.find((r) => r.itemId === "i3")!.scheduled).toBe(false);
  });
  it("builds a span from two separate columns", () => {
    const { rows: r2 } = buildGanttRows(
      items,
      twoColCells,
      "s1",
      "e1",
      "2026-06-01",
      30,
      "month",
    );
    expect(r2.find((r) => r.itemId === "i1")).toMatchObject({
      startCol: 1,
      spanCols: 5,
      isMilestone: false,
      scheduled: true,
    });
  });
});

describe("detectViolations", () => {
  it("flags a successor that starts before its predecessor ends", () => {
    const { rows } = buildGanttRows(
      items,
      cells,
      "d1",
      null,
      "2026-06-01",
      30,
      "month",
    );
    const deps = [
      { id: "dep1", predecessor_id: "i1", successor_id: "i2" },
    ] as never;
    expect(detectViolations(rows, deps).has("dep1")).toBe(true);
  });
});

describe("onBarMoved (two columns)", () => {
  it("shifts both the start and end column by the delta", () => {
    const writes: unknown[] = [];
    onBarMoved(
      "i1",
      2,
      { start: "2026-06-02", end: "2026-06-05" },
      "s1",
      "e1",
      (a) => writes.push(a),
    );
    expect(writes).toEqual([
      { itemId: "i1", columnId: "s1", value: { date: "2026-06-04" } },
      { itemId: "i1", columnId: "e1", value: { date: "2026-06-07" } },
    ]);
  });
  it("writes a single-column range when endColumnId is null (legacy)", () => {
    const writes: unknown[] = [];
    onBarMoved(
      "i1",
      1,
      { start: "2026-06-02", end: "2026-06-05" },
      "d1",
      null,
      (a) => writes.push(a),
    );
    expect(writes).toEqual([
      {
        itemId: "i1",
        columnId: "d1",
        value: { date: "2026-06-03", end: "2026-06-06" },
      },
    ]);
  });
});

describe("onBarResized (two columns)", () => {
  it("writes only the end column when endColumnId is set", () => {
    const writes: unknown[] = [];
    onBarResized(
      "i1",
      "2026-06-09",
      { start: "2026-06-02", end: "2026-06-05" },
      "s1",
      "e1",
      (a) => writes.push(a),
    );
    expect(writes).toEqual([
      { itemId: "i1", columnId: "e1", value: { date: "2026-06-09" } },
    ]);
  });
  it("writes a single-column range when endColumnId is null (legacy)", () => {
    const writes: unknown[] = [];
    onBarResized(
      "i1",
      "2026-06-09",
      { start: "2026-06-02", end: "2026-06-05" },
      "d1",
      null,
      (a) => writes.push(a),
    );
    expect(writes).toEqual([
      {
        itemId: "i1",
        columnId: "d1",
        value: { date: "2026-06-02", end: "2026-06-09" },
      },
    ]);
  });
});

describe("timelineDayCount", () => {
  it("returns the zoom floor when the data fits inside it", () => {
    expect(timelineDayCount("2026-01-01", "2026-01-05", 90)).toBe(90);
  });
  it("extends to fit the latest date (inclusive) plus padding", () => {
    // 2026-01-01 → 2026-06-01 is 151 days; +1 inclusive +3 pad = 155.
    expect(timelineDayCount("2026-01-01", "2026-06-01", 90)).toBe(155);
  });
  it("falls back to the floor when either bound is empty", () => {
    expect(timelineDayCount("", "2026-06-01", 90)).toBe(90);
    expect(timelineDayCount("2026-01-01", "", 90)).toBe(90);
  });
  it("caps a far-future end date to guard against typos", () => {
    expect(timelineDayCount("2026-01-01", "2100-01-01", 90)).toBe(3660);
  });
});
