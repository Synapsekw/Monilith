import { describe, it, expect, vi } from "vitest";
import {
  buildGanttRows,
  detectViolations,
  onBarMoved,
  onBarResized,
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

describe("buildGanttRows", () => {
  const { rows } = buildGanttRows(
    items,
    cells,
    "d1",
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
});

describe("detectViolations", () => {
  it("flags a successor that starts before its predecessor ends", () => {
    const { rows } = buildGanttRows(
      items,
      cells,
      "d1",
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

describe("onBarMoved / onBarResized", () => {
  it("move shifts date+end by delta", () => {
    const setCell = vi.fn();
    onBarMoved(
      "i1",
      2,
      { start: "2026-06-02", end: "2026-06-04" },
      "d1",
      setCell,
    );
    expect(setCell).toHaveBeenCalledWith({
      itemId: "i1",
      columnId: "d1",
      value: { date: "2026-06-04", end: "2026-06-06" },
    });
  });
  it("resize writes the new end", () => {
    const setCell = vi.fn();
    onBarResized(
      "i1",
      "2026-06-06",
      { start: "2026-06-02", end: "2026-06-04" },
      "d1",
      setCell,
    );
    expect(setCell).toHaveBeenCalledWith({
      itemId: "i1",
      columnId: "d1",
      value: { date: "2026-06-02", end: "2026-06-06" },
    });
  });
});
