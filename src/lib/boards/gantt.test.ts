import { describe, it, expect } from "vitest";
import {
  buildGanttRows,
  detectViolations,
  onBarMoved,
  onBarResized,
  groupTimelineRows,
  rangeIncludingToday,
  spanOfRows,
  timelineDayCount,
  visibleRows,
  type GanttRow,
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

describe("buildGanttRows — sub-item nesting", () => {
  const nestedItems = [
    { id: "p1", name: "Parent", parent_id: null, position: 0 },
    { id: "c2", name: "Child B", parent_id: "p1", position: 1 },
    { id: "c1", name: "Child A", parent_id: "p1", position: 0 },
    { id: "t2", name: "Top 2", parent_id: null, position: 1 },
  ] as never;
  const nestedCells = [
    { item_id: "p1", column_id: "d1", value: { date: "2026-06-01" } },
    { item_id: "c1", column_id: "d1", value: { date: "2026-06-02" } },
    { item_id: "c2", column_id: "d1", value: { date: "2026-06-03" } },
    { item_id: "t2", column_id: "d1", value: { date: "2026-06-05" } },
  ] as never;

  it("orders rows parent → children (by position) → next parent, with depths", () => {
    const { rows } = buildGanttRows(
      nestedItems,
      nestedCells,
      "d1",
      null,
      "2026-06-01",
      30,
      "month",
    );
    expect(rows.map((r) => r.itemId)).toEqual(["p1", "c1", "c2", "t2"]);
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 1, 0]);
  });

  it("annotates a parent with its scheduled child count and children with parentId", () => {
    const { rows } = buildGanttRows(
      nestedItems,
      nestedCells,
      "d1",
      null,
      "2026-06-01",
      30,
      "month",
    );
    const parent = rows.find((r) => r.itemId === "p1")!;
    expect(parent.hasChildren).toBe(true);
    expect(parent.childCount).toBe(2);
    expect(rows.find((r) => r.itemId === "c1")!.parentId).toBe("p1");
    expect(rows.find((r) => r.itemId === "t2")!.hasChildren).toBe(false);
  });

  it("counts only scheduled children in childCount", () => {
    const cellsChildUnscheduled = [
      { item_id: "p1", column_id: "d1", value: { date: "2026-06-01" } },
      { item_id: "c1", column_id: "d1", value: { date: "2026-06-02" } },
      // c2 has no date → unscheduled
    ] as never;
    const { rows } = buildGanttRows(
      nestedItems,
      cellsChildUnscheduled,
      "d1",
      null,
      "2026-06-01",
      30,
      "month",
    );
    expect(rows.find((r) => r.itemId === "p1")!.childCount).toBe(1);
    const c2 = rows.find((r) => r.itemId === "c2")!;
    expect(c2.scheduled).toBe(false);
    expect(c2.depth).toBe(1);
  });
});

describe("visibleRows", () => {
  const rows = [
    { itemId: "p1", name: "P", scheduled: true, depth: 0, parentId: null },
    { itemId: "c1", name: "C", scheduled: true, depth: 1, parentId: "p1" },
    { itemId: "t2", name: "T", scheduled: true, depth: 0, parentId: null },
  ] as GanttRow[];

  it("hides children when their parent is collapsed", () => {
    expect(visibleRows(rows, new Set()).map((r) => r.itemId)).toEqual([
      "p1",
      "t2",
    ]);
  });

  it("shows children when their parent is expanded", () => {
    expect(visibleRows(rows, new Set(["p1"])).map((r) => r.itemId)).toEqual([
      "p1",
      "c1",
      "t2",
    ]);
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

describe("rangeIncludingToday", () => {
  it("widens a past-only range forward to today + 30", () => {
    expect(
      rangeIncludingToday("2026-02-01", "2026-03-01", "2026-11-14"),
    ).toEqual({ startISO: "2026-02-01", endISO: "2026-12-14" });
  });
  it("widens a future-only range back to today − 14", () => {
    expect(
      rangeIncludingToday("2027-01-10", "2027-02-01", "2026-11-14"),
    ).toEqual({ startISO: "2026-10-31", endISO: "2027-02-01" });
  });
  it("falls back to the padded today window when nothing is dated", () => {
    expect(rangeIncludingToday(null, null, "2026-11-14")).toEqual({
      startISO: "2026-10-31",
      endISO: "2026-12-14",
    });
  });
  it("leaves a range that already contains the window alone", () => {
    expect(
      rangeIncludingToday("2026-01-01", "2027-06-01", "2026-11-14"),
    ).toEqual({ startISO: "2026-01-01", endISO: "2027-06-01" });
  });
});

describe("groupTimelineRows", () => {
  const row = (
    itemId: string,
    startCol: number,
    spanCols: number,
    over: Partial<GanttRow> = {},
  ): GanttRow => ({
    itemId,
    name: itemId,
    scheduled: true,
    depth: 0,
    parentId: null,
    startCol,
    spanCols,
    ...over,
  });
  // Board order (position across the whole board), as buildGanttRows emits it.
  const rows: GanttRow[] = [
    row("a1", 2, 3),
    row("b1", 0, 4, { hasChildren: true, childCount: 1 }),
    row("b1c", 5, 5, { depth: 1, parentId: "b1" }),
    row("b2", 8, 1),
  ];
  const groupOfItem = new Map([
    ["a1", "g2"],
    ["b1", "g1"],
    ["b1c", "g1"],
    ["b2", "g1"],
  ]);
  const groups = [
    { id: "g2", name: "Build", position: 1 },
    { id: "g1", name: "Discovery", position: 0 },
    { id: "g3", name: "Empty", position: 2 },
  ];
  const base = {
    collapsedGroups: new Set<string>(),
    expanded: new Set<string>(),
    isDone: (id: string) => id === "b2",
    lateFor: (r: GanttRow) => (r.itemId === "b1" ? 4 : null),
  };
  const ids = (out: GanttRow[]) => out.map((r) => r.itemId);

  it("emits a band per group in position order, then that group's rows", () => {
    expect(ids(groupTimelineRows(rows, groupOfItem, groups, base))).toEqual([
      "group:g1",
      "b1",
      "b2",
      "group:g2",
      "a1",
    ]);
  });

  it("skips a group with nothing on the timeline", () => {
    expect(
      ids(groupTimelineRows(rows, groupOfItem, groups, base)),
    ).not.toContain("group:g3");
  });

  it("summarises span, done share and late count over the group's scheduled rows", () => {
    const band = groupTimelineRows(rows, groupOfItem, groups, base)[0]!;
    expect(band).toMatchObject({
      kind: "section",
      level: 1,
      name: "Discovery",
      scheduled: false,
    });
    // b1 0–4, its hidden sub-item b1c 5–10, b2 8–9 → span 0–10; 1 of 3 done.
    expect(band.summary).toEqual({
      startCol: 0,
      spanCols: 10,
      donePct: 33,
      lateCount: 1,
    });
  });

  it("keeps a collapsed group's band and summary but hides its rows", () => {
    const out = groupTimelineRows(rows, groupOfItem, groups, {
      ...base,
      collapsedGroups: new Set(["g1"]),
    });
    expect(ids(out)).toEqual(["group:g1", "group:g2", "a1"]);
    expect(out[0]!.summary?.spanCols).toBe(10);
  });

  it("reveals the sub-items of an expanded parent inside its group", () => {
    expect(
      ids(
        groupTimelineRows(rows, groupOfItem, groups, {
          ...base,
          expanded: new Set(["b1"]),
        }),
      ),
    ).toEqual(["group:g1", "b1", "b1c", "b2", "group:g2", "a1"]);
  });

  it("collects rows whose group is unknown under a trailing band", () => {
    const partial = new Map([
      ["b1", "g1"],
      ["b1c", "g1"],
      ["b2", "g1"],
    ]);
    const out = groupTimelineRows(rows, partial, groups, base);
    expect(ids(out)).toEqual([
      "group:g1",
      "b1",
      "b2",
      "group:__ungrouped__",
      "a1",
    ]);
    expect(out[3]!.name).toBe("Other items");
  });
});

describe("spanOfRows", () => {
  it("is null when no row is scheduled", () => {
    expect(
      spanOfRows([
        { itemId: "p", name: "p", scheduled: false, hasChildren: true },
      ]),
    ).toBeNull();
  });
});
