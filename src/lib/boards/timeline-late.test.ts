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
    name: "Status",
    kind: "status",
    position: 0,
    settings: {
      options: [
        { id: "open", label: "Working" },
        { id: "done", label: "Done" },
      ],
    },
  },
  { id: "c-start", name: "Start", kind: "date", position: 1, settings: {} },
  { id: "c-due", name: "Due", kind: "date", position: 2, settings: {} },
] as never;

const items = ["late", "done", "future", "started", "sub"].map((id) => ({
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
  cv("late", "c-due", { date: "2026-10-01", end: "2026-10-24" }),
  cv("done", "c-due", { date: "2026-10-01" }),
  cv("done", "c-status", { optionId: "done" }),
  cv("future", "c-due", { date: "2026-12-01" }),
  // Started in the past (the Start column), due in the future: NOT late. Only
  // the board's ONE due column counts; under the old rule any past date did.
  cv("started", "c-start", { date: "2026-11-10" }),
  cv("started", "c-due", { date: "2026-12-01" }),
  cv("sub", "c-due", { date: "2026-11-13" }),
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
  it("counts whole days since the due date, open items only", () => {
    expect([...late().lateDays.entries()]).toEqual([
      ["late", 21],
      ["sub", 1],
    ]);
  });

  it("a past date in a column that is not the due column is not late", () => {
    expect(late().lateDays.has("started")).toBe(false);
  });

  it("follows the board's configured due column and done options", () => {
    const res = buildTimelineLate({
      items,
      columns,
      cellMap: buildCellMap(cellValues),
      todayISO: TODAY,
      board: {
        work_status_column_id: "c-status",
        work_done_option_ids: ["open"],
        work_due_column_id: "c-start",
      },
    });
    // Due column is now Start: only "started" has a past date there, and it
    // has no status, so it is open and late.
    expect([...res.lateDays.entries()]).toEqual([["started", 4]]);
    // "Working" is the configured done option; the "Done" label is not.
    expect(res.isDone("done")).toBe(false);
  });

  it("reads done from the rule's status column (guess: a done-looking label)", () => {
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
    expect(overdue?.itemIds).toHaveLength(2);
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
