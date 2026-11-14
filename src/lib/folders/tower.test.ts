import { describe, expect, it } from "vitest";
import { buildStages } from "./stages";
import type { BurnPoint } from "./rollup";
import { FIXTURE_TODAY, folderFixture } from "./fixture";
import {
  addDays,
  attentionGroups,
  burnForecast,
  forecastReading,
  kpiTrends,
  loadGrid,
  mondayOf,
  stageBars,
  trendChange,
} from "./tower";
import type { BurnRow, LoadRow } from "./types";

const wk = (
  weekStart: string,
  planned: number,
  completed: number,
  overdueOpen = 0,
  importedDone = 0,
): BurnRow => ({
  stageKey: "build",
  weekStart,
  planned,
  completed,
  overdueOpen,
  importedDone,
});

describe("date helpers", () => {
  it("adds days across a month boundary and finds the Monday", () => {
    expect(addDays("2026-09-28", 7)).toBe("2026-10-05");
    expect(mondayOf("2026-09-15")).toBe("2026-09-14"); // a Tuesday
    expect(mondayOf("2026-09-14")).toBe("2026-09-14");
    expect(mondayOf("2026-09-20")).toBe("2026-09-14"); // a Sunday
  });
});

describe("kpiTrends", () => {
  const rows = [
    wk("2026-08-24", 2, 1, 0),
    wk("2026-08-31", 3, 1, 1),
    wk("2026-09-07", 2, 1, 2),
    wk("2026-09-14", 3, 1, 4),
    wk("2026-09-21", 5, 0, 0),
    wk("2026-09-28", 1, 0, 0),
  ];

  it("builds past series up to the current week and a forward series for due", () => {
    const t = kpiTrends(rows, null, "2026-09-15", 20);
    expect(t.complete?.points).toEqual([5, 10, 15, 20]);
    expect(t.complete?.delta).toBe(5);
    expect(t.gap?.points).toEqual([-1, -3, -4, -6]);
    expect(t.gap?.delta).toBe(-2);
    expect(t.overdue?.points).toEqual([0, 1, 2, 4]);
    expect(t.dueThisWeek).toEqual({
      kind: "bars",
      points: [3, 5, 1],
      delta: 2,
    });
  });

  it("keeps at most eight past weeks", () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      wk(addDays("2026-06-29", i * 7), 1, 1, i),
    );
    const t = kpiTrends(many, null, "2026-09-15", 12);
    expect(t.overdue?.points).toHaveLength(8);
    expect(t.overdue?.points.at(-1)).toBe(11);
  });

  it("returns nothing for a folder younger than two weeks or with no rows", () => {
    expect(kpiTrends([], null, "2026-09-15", 5)).toEqual({});
    expect(kpiTrends([wk("2026-09-14", 1, 0)], null, "2026-09-15", 5)).toEqual(
      {},
    );
  });

  it("filters by stage and omits complete when the total is zero", () => {
    const mixed = [...rows, { ...wk("2026-09-07", 9, 9), stageKey: "qa" }];
    expect(kpiTrends(mixed, "build", "2026-09-15", 20).gap?.points).toEqual([
      -1, -3, -4, -6,
    ]);
    expect(kpiTrends(rows, null, "2026-09-15", 0).complete).toBeUndefined();
  });
});

describe("trendChange", () => {
  it("colours by meaning, not by sign, and always states the direction", () => {
    expect(
      trendChange("overdue", { kind: "line", points: [1, 4], delta: 3 }),
    ).toEqual({
      text: "+3 this week",
      tone: "red",
    });
    expect(
      trendChange("overdue", { kind: "line", points: [4, 1], delta: -3 }),
    ).toEqual({
      text: "−3 this week",
      tone: "green",
    });
    expect(
      trendChange("complete", { kind: "line", points: [10, 12], delta: 2 }),
    ).toEqual({
      text: "+2 pts this week",
      tone: "green",
    });
    expect(
      trendChange("gap", { kind: "line", points: [-10, -58], delta: -48 }),
    ).toEqual({
      text: "48 wider",
      tone: "red",
    });
    expect(
      trendChange("gap", { kind: "line", points: [-10, -4], delta: 6 }),
    ).toEqual({
      text: "6 closer",
      tone: "green",
    });
    expect(
      trendChange("overdue", { kind: "line", points: [2, 2], delta: 0 }),
    ).toEqual({
      text: "flat",
      tone: "gray",
    });
    expect(
      trendChange("dueThisWeek", { kind: "bars", points: [3, 5], delta: 2 }),
    ).toEqual({
      text: "5 next week",
      tone: "blue",
    });
  });
});

const pt = (
  weekStart: string,
  planned: number,
  completed: number,
  plannedCum: number,
  completedCum: number,
  isPast: boolean,
  importedDone = 0,
): BurnPoint => ({
  weekStart,
  planned,
  completed,
  plannedCum,
  completedCum,
  isPast,
  importedDone,
});

describe("burnForecast", () => {
  const points = [
    pt("2026-08-17", 4, 2, 4, 2, true),
    pt("2026-08-24", 4, 2, 8, 4, true),
    pt("2026-08-31", 4, 4, 12, 8, true),
    pt("2026-09-07", 4, 4, 16, 12, true),
    pt("2026-09-14", 4, 1, 20, 13, true),
    pt("2026-09-21", 4, 0, 24, 13, false),
    pt("2026-09-28", 0, 0, 24, 13, false),
  ];

  it("paces on the four full weeks before the current one", () => {
    const f = burnForecast(points, 24)!;
    expect(f.pace).toBe(3);
    expect(f.remaining).toBe(11);
    expect(f.gapNow).toBe(-7);
    expect(f.finishWeek).toBe("2026-10-12"); // ceil(11 / 3) = 4 weeks after 09-14
    expect(f.lastPlannedWeek).toBe("2026-09-21");
    expect(f.weeksLate).toBe(3);
    expect(f.line.map((p) => p.value)).toEqual([13, 16, 19]);
    expect(forecastReading(f)).toBe(
      "At 3 a week the folder finishes around Oct 12, 3 weeks after its last planned date.",
    );
  });

  it("leaves imported completions out of the pace and says so", () => {
    const imported = points.map((p) =>
      p.weekStart === "2026-09-07" ? { ...p, importedDone: 4 } : p,
    );
    const f = burnForecast(imported, 24)!;
    expect(f.pace).toBe(2);
    expect(f.importedDone).toBe(4);
    expect(forecastReading(f)).toContain(
      "4 items arrived already done and are left out of the pace.",
    );
  });

  it("reports a zero pace instead of a date", () => {
    const flat = points.map((p) => ({
      ...p,
      completed: p.isPast && p.weekStart !== "2026-09-14" ? 0 : p.completed,
    }));
    const f = burnForecast(flat, 24)!;
    expect(f.pace).toBe(0);
    expect(f.finishWeek).toBeNull();
    expect(forecastReading(f)).toBe(
      "No items completed in the last four weeks.",
    );
  });

  it("handles a finished scope, a capped line and no past week", () => {
    expect(forecastReading(burnForecast(points, 13)!)).toBe(
      "Everything in scope is done.",
    );
    expect(burnForecast(points, 15)!.line.map((p) => p.value)).toEqual([
      13, 15, 15,
    ]);
    expect(
      burnForecast(
        points.map((p) => ({ ...p, isPast: false })),
        24,
      ),
    ).toBeNull();
  });
});

describe("loadGrid", () => {
  const boards = [
    { id: "b2", name: "Mobile", position: 1 },
    { id: "b1", name: "Backend", position: 0 },
  ];
  const rows: LoadRow[] = [
    { boardId: "b1", stageKey: "build", weekStart: "2026-08-24", openDue: 5 },
    { boardId: "b1", stageKey: "qa", weekStart: "2026-08-24", openDue: 2 },
    { boardId: "b1", stageKey: "build", weekStart: "2026-09-14", openDue: 3 },
    { boardId: "b2", stageKey: "build", weekStart: "2026-10-05", openDue: 4 },
    { boardId: "b2", stageKey: "build", weekStart: "2026-11-30", openDue: 9 }, // outside the window
  ];

  it("lays seven weeks around today with boards in position order", () => {
    const g = loadGrid(
      rows,
      boards,
      { stageKey: null, boardId: null },
      "2026-09-15",
    );
    expect(g.weeks.map((w) => w.label)).toEqual([
      "≤ −3w",
      "−2w",
      "−1w",
      "now",
      "+1w",
      "+2w",
      "+3w",
    ]);
    expect(g.weeks.map((w) => w.past)).toEqual([
      true,
      true,
      true,
      false,
      false,
      false,
      false,
    ]);
    expect(g.weeks[0]!.weekStart).toBe("2026-08-24");
    expect(g.rows.map((r) => r.name)).toEqual(["Backend", "Mobile"]);
    expect(g.rows[0]!.cells).toEqual([7, 0, 0, 3, 0, 0, 0]);
    expect(g.rows[1]!.cells).toEqual([0, 0, 0, 0, 0, 0, 4]);
    expect(g.max).toBe(7);
  });

  it("applies the stage and board filters", () => {
    const g = loadGrid(
      rows,
      boards,
      { stageKey: "qa", boardId: "b1" },
      "2026-09-15",
    );
    expect(g.rows).toHaveLength(1);
    expect(g.rows[0]!.cells).toEqual([2, 0, 0, 0, 0, 0, 0]);
  });

  it("returns zero rows of zeros for a board with nothing due", () => {
    const g = loadGrid(
      [],
      boards,
      { stageKey: null, boardId: null },
      "2026-09-15",
    );
    expect(g.max).toBe(0);
    expect(g.rows[0]!.cells).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });
});

describe("attentionGroups and stageBars", () => {
  const fx = folderFixture();

  it("groups by board with totals taken from the rollup, worst first", () => {
    const groups = attentionGroups(fx.rollup!, fx.attention!, FIXTURE_TODAY);
    for (const g of groups) {
      const rows = fx.rollup!.filter((r) => r.boardId === g.boardId);
      expect(g.overdue).toBe(rows.reduce((s, r) => s + r.overdue, 0));
      expect(g.blocked).toBe(rows.reduce((s, r) => s + r.blocked, 0));
      expect(g.items.every((a) => a.boardId === g.boardId)).toBe(true);
    }
    const overdue = groups.map((g) => g.overdue);
    expect(overdue).toEqual([...overdue].sort((a, b) => b - a));
    expect(groups.flatMap((g) => g.items)).toHaveLength(fx.attention!.length);
  });

  it("drops boards with nothing to report", () => {
    const clean = fx.rollup!.map((r) => ({
      ...r,
      overdue: 0,
      blocked: 0,
      unassigned: 0,
      stale: 0,
      oldestOverdue: null,
    }));
    expect(attentionGroups(clean, [], FIXTURE_TODAY)).toEqual([]);
  });

  it("turns stages into bars with totals, done and stale", () => {
    const stages = buildStages(fx.rollup!, FIXTURE_TODAY);
    const bars = stageBars(stages);
    expect(bars.map((b) => b.name)).toEqual(
      stages.filter((s) => s.total > 0).map((s) => s.name),
    );
    expect(bars[0]).toMatchObject({
      total: stages[0]!.total,
      done: stages[0]!.done,
      stale: stages[0]!.stale,
    });
  });
});
