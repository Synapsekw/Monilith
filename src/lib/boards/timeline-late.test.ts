import { describe, expect, it } from "vitest";
import { buildCellMap } from "@/lib/boards/cache";
import { computeSignals } from "@/lib/boards/intelligence/signals";
import { localTodayISO } from "@/lib/boards/overdue";
import { buildTimelineLate } from "@/lib/boards/timeline-late";

// Sat 14 Nov 2026, 12:00 viewer-local.
const NOW = new Date(2026, 10, 14, 12, 0, 0);
const TODAY = localTodayISO(NOW);

const columns = [
  {
    id: "c-status",
    kind: "status",
    position: 0,
    settings: {
      options: [
        { id: "open", label: "Working" },
        { id: "done", label: "Done" },
      ],
    },
  },
  { id: "c-start", kind: "date", position: 1, settings: {} },
  { id: "c-due", kind: "date", position: 2, settings: {} },
] as never;

const items = ["late", "done", "future", "other-col", "sub"].map((id) => ({
  id,
  name: id,
  group_id: "g1",
  parent_id: id === "sub" ? "late" : null,
  position: 0,
  updated_at: "2026-11-01T00:00:00Z",
})) as never;

const cv = (item_id: string, column_id: string, value: unknown) => ({
  item_id,
  column_id,
  value,
  updated_at: "2026-11-01T00:00:00Z",
});
const cellValues = [
  cv("late", "c-start", { date: "2026-10-01", end: "2026-10-24" }),
  cv("done", "c-start", { date: "2026-10-01" }),
  cv("done", "c-status", { optionId: "done" }),
  cv("future", "c-start", { date: "2026-12-01" }),
  // On time in the timeline's own column, past due in another date column.
  cv("other-col", "c-start", { date: "2026-12-01" }),
  cv("other-col", "c-due", { date: "2026-11-10" }),
  cv("sub", "c-start", { date: "2026-11-13" }),
] as never;

function late() {
  return buildTimelineLate({
    items,
    columns,
    cellMap: buildCellMap(cellValues),
    todayISO: TODAY,
  });
}

describe("buildTimelineLate", () => {
  it("counts whole days since the earliest past-due date, open items only", () => {
    expect([...late().lateDays.entries()]).toEqual([
      ["late", 21],
      ["other-col", 4],
      ["sub", 1],
    ]);
  });

  it("reads done from the first status column's done/complete label", () => {
    expect(late().isDone("done")).toBe(true);
    expect(late().isDone("late")).toBe(false);
  });

  it("marks exactly the items the Board Intelligence overdue chip counts", () => {
    const overdue = computeSignals(
      { items, columns, cellValues, groups: [], dependencies: [] } as never,
      { now: NOW, lastSeenAt: null, currentUserId: "u1" },
    ).find((s) => s.kind === "overdue");
    expect([...late().lateDays.keys()].sort()).toEqual(
      [...(overdue?.itemIds ?? [])].sort(),
    );
    expect(overdue?.itemIds).toHaveLength(3);
  });

  it("has no late items on a board with no date column", () => {
    const res = buildTimelineLate({
      items,
      columns: [] as never,
      cellMap: buildCellMap(cellValues),
      todayISO: TODAY,
    });
    expect(res.lateDays.size).toBe(0);
    expect(res.isDone("done")).toBe(false);
  });
});
