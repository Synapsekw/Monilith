import { describe, expect, it } from "vitest";
import { buildStages } from "./stages";
import { unpackBurnPacked } from "./packed";
import { burnSeries, type BurnPoint } from "./rollup";
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
    expect(addDays("2026-12-28", 7)).toBe("2027-01-04");
    expect(mondayOf("2027-01-01")).toBe("2026-12-28"); // a Friday
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

  it("has no current-week point when the burn rows end before today", () => {
    const gap = [...rows.slice(0, 4), wk("2026-11-02", 2, 0, 0)];
    const t = kpiTrends(gap, null, "2026-10-20", 20);
    expect(t.overdue?.points).toEqual([0, 1, 2, 4]);
    expect(t.dueThisWeek).toBeUndefined();
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

  it("pluralises the imported suffix", () => {
    const one = points.map((p) =>
      p.weekStart === "2026-09-07" ? { ...p, importedDone: 1 } : p,
    );
    expect(forecastReading(burnForecast(one, 24)!)).toContain(
      " 1 item arrived already done and is left out of the pace.",
    );
    const two = points.map((p) =>
      p.weekStart === "2026-09-07" ? { ...p, importedDone: 2 } : p,
    );
    expect(forecastReading(burnForecast(two, 24)!)).toContain(
      " 2 items arrived already done and are left out of the pace.",
    );
  });

  it("does not say late when it finishes before the last planned date", () => {
    const f = burnForecast(points, 16)!; // remaining 3 at pace 3: one week
    expect(f.finishWeek).toBe("2026-09-21");
    expect(f.weeksLate).toBe(0);
    expect(forecastReading(f)).toBe(
      "At 3 a week the folder finishes around Sep 21.",
    );
  });

  it("needs two full past weeks before it forecasts", () => {
    const first = (n: number) => points.slice(0, n);
    expect(burnForecast(first(0), 24)).toBeNull();
    for (const n of [1, 2]) {
      const f = burnForecast(first(n), 24)!;
      expect(f.insufficientHistory).toBe(true);
      expect(f.line).toEqual([]);
      expect(f.finishWeek).toBeNull();
      expect(forecastReading(f)).toBe("Not enough history yet to forecast.");
    }
    // 3 past points: two full weeks (2, 2) -> mean 2
    const three = burnForecast(first(3), 24)!;
    expect(three.insufficientHistory).toBe(false);
    expect(three.pace).toBe(2);
    // 4 past points: three full weeks (2, 2, 4) -> mean 8/3
    expect(burnForecast(first(4), 24)!.pace).toBeCloseTo(8 / 3);
  });

  /** Re-derive completedCum after editing `completed`. */
  const recum = (ps: BurnPoint[]): BurnPoint[] => {
    let c = 0;
    return ps.map((p) => ({ ...p, completedCum: (c += p.completed) }));
  };

  it("reports a zero pace instead of a date", () => {
    const flat = recum(
      points.map((p) => ({
        ...p,
        completed: p.isPast && p.weekStart !== "2026-09-14" ? 0 : p.completed,
      })),
    );
    const f = burnForecast(flat, 24)!;
    expect(f.pace).toBe(0);
    expect(f.finishWeek).toBeNull();
    expect(f.windowWeeks).toBe(4);
    // The one completion is in the current week, outside the pace window.
    expect(forecastReading(f)).toBe(
      "No items were completed in the 4 full weeks before this one, so there is no pace yet; 1 was completed this week.",
    );
    const none = recum(
      flat.map((p) =>
        p.weekStart === "2026-09-14" ? { ...p, completed: 0 } : p,
      ),
    );
    expect(forecastReading(burnForecast(none, 24)!)).toBe(
      "No items were completed in the 4 full weeks before this one, so there is no pace yet.",
    );
  });

  it("names the real window when only two full weeks precede this one", () => {
    const short = recum([
      pt("2026-08-31", 4, 0, 4, 0, true),
      pt("2026-09-07", 4, 0, 8, 0, true),
      pt("2026-09-14", 4, 2, 12, 0, true),
      pt("2026-09-21", 4, 0, 16, 0, false),
    ]);
    const f = burnForecast(short, 16)!;
    expect(f.windowWeeks).toBe(2);
    expect(forecastReading(f)).toBe(
      "No items were completed in the 2 full weeks before this one, so there is no pace yet; 2 were completed this week.",
    );
  });

  it("says there is no recent pace when completions predate the window", () => {
    const old = recum([
      pt("2026-08-10", 4, 3, 4, 0, true),
      ...points.map((p) => ({
        ...p,
        completed: p.weekStart === "2026-08-10" || !p.isPast ? p.completed : 0,
      })),
    ]);
    const f = burnForecast(old, 24)!;
    expect(f.completedBeforeWindow).toBe(3);
    expect(forecastReading(f)).toBe(
      "No items were completed in the 4 full weeks before this one, so there is no recent pace.",
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

describe("kpiTrends agreement with the cards", () => {
  const rows = [
    wk("2026-08-24", 2, 1, 0),
    wk("2026-08-31", 3, 1, 1),
    wk("2026-09-07", 2, 1, 2),
    wk("2026-09-14", 3, 1, 4),
    wk("2026-09-21", 5, 0, 0),
    wk("2026-09-28", 1, 0, 0),
  ];
  const now = { complete: 30, gap: -9, overdue: 7, dueThisWeek: 2 };

  it("ends every past series on the card's value and starts due on it", () => {
    const t = kpiTrends(rows, null, "2026-09-15", 20, now);
    expect(t.complete?.points).toEqual([5, 10, 15, 30]);
    expect(t.complete?.delta).toBe(15);
    expect(t.gap?.points).toEqual([-1, -3, -4, -9]);
    expect(t.overdue?.points).toEqual([0, 1, 2, 7]);
    expect(t.dueThisWeek?.points).toEqual([2, 5, 1]);
    expect(t.dueThisWeek?.delta).toBe(3);
  });

  it("appends the card value when the burn rows stop before this week", () => {
    const t = kpiTrends(rows.slice(0, 3), null, "2026-09-15", 20, now);
    expect(t.gap?.points).toEqual([-1, -3, -4, -9]);
    expect(t.dueThisWeek).toBeUndefined();
  });

  it("drops a card's trend when the card has no value", () => {
    const t = kpiTrends(rows, null, "2026-09-15", 20, { ...now, gap: null });
    expect(t.gap).toBeUndefined();
    expect(t.complete).toBeDefined();
  });

  it("hides the overdue trend while folder_burn has no overdue_open column", () => {
    const old = rows.map(({ overdueOpen: _o, importedDone: _i, ...r }) => r);
    expect(kpiTrends(old, null, "2026-09-15", 20, now).overdue).toBeUndefined();
    expect(kpiTrends(old, null, "2026-09-15", 20, now).gap).toBeDefined();
  });
});

/**
 * Shaped like the live DAAS folder on 2026-11-14: 56 stages x 73 weekly
 * buckets (4,088 folder_burn rows), 1,953 items all dated, 663 done, every one
 * of them completed (and created) in the current week, i.e. imported.
 */
function daasRows(imported: boolean): BurnRow[] {
  const out: BurnRow[] = [];
  let planned = 0;
  for (let s = 0; s < 56; s++)
    for (let w = 0; w < 73; w++) {
      const weekStart = addDays("2026-01-26", w * 7);
      const p = planned < 1953 && (s * 73 + w) % 2 === 0 ? 1 : 0;
      planned += p;
      const c = weekStart === "2026-11-09" ? (s < 47 ? 12 : 11) : 0;
      out.push({
        stageKey: `stage-${String(s).padStart(2, "0")}`,
        weekStart,
        planned: p,
        completed: c,
        ...(imported ? { importedDone: c, overdueOpen: 0 } : {}),
      });
    }
  return out;
}

describe("a DAAS-shaped folder", () => {
  const today = "2026-11-14";
  const card = { complete: 34, gap: -341, overdue: 601, dueThisWeek: 91 };

  it("is 4,088 rows whose sums match the rollup, unlike a 1,000-row cut", () => {
    const rows = daasRows(false);
    expect(rows).toHaveLength(4088);
    const sum = (rs: BurnRow[], k: "planned" | "completed") =>
      rs.reduce((a, r) => a + r[k], 0);
    expect(sum(rows, "planned")).toBe(1953);
    expect(sum(rows, "completed")).toBe(663);
    // What PostgREST's max_rows used to hand the page:
    expect(sum(rows.slice(0, 1000), "completed")).toBeLessThan(663);
  });

  it("puts the card's numbers at the end of the complete and gap trends", () => {
    const t = kpiTrends(daasRows(false), null, today, 1953, card);
    expect(t.complete?.points.at(-1)).toBe(34);
    expect(t.gap?.points.at(-1)).toBe(-341);
    expect(t.dueThisWeek?.points[0]).toBe(91);
    // Old RPC: no overdue_open, so no overdue line of zeros.
    expect(t.overdue).toBeUndefined();
  });

  it("does not claim nothing was completed when the week's work is new", () => {
    const pts = burnSeries(daasRows(false), null, today);
    const f = burnForecast(pts, 1953, { importedKnown: false })!;
    expect(f.pace).toBe(0);
    expect(forecastReading(f)).toBe(
      "No items were completed in the 4 full weeks before this one, so there is no pace yet; 663 were completed this week.",
    );
  });

  it("says everything arrived done once imported_done is known", () => {
    const pts = burnSeries(daasRows(true), null, today);
    const f = burnForecast(pts, 1953, { importedKnown: true })!;
    expect(forecastReading(f)).toBe(
      "Everything completed so far arrived already done, so there is no pace to forecast from.",
    );
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

  it("folds rows older than the window into the first column", () => {
    const g = loadGrid(
      [
        ...rows,
        {
          boardId: "b1",
          stageKey: "build",
          weekStart: "2026-06-01",
          openDue: 6,
        },
      ],
      boards,
      { stageKey: null, boardId: null },
      "2026-09-15",
    );
    expect(g.rows[0]!.cells).toEqual([13, 0, 0, 3, 0, 0, 0]);
    expect(g.max).toBe(13);
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

describe("packed burn rows feed the tower as known values", () => {
  // 4 weeks from 2026-09-07, stage build: 3 imported-done in week 0, overdue open 0,1,1,2.
  const packed = unpackBurnPacked({
    lo: "2026-09-07",
    hi: "2026-09-28",
    stages: ["build"],
    rows: [
      [0, 0, 4, 4, 3, 0],
      [0, 1, 4, 1, 0, 1],
      [0, 2, 4, 1, 0, 1],
      [0, 3, 4, 1, 0, 2],
    ],
  });
  if (!packed.ok) throw new Error("fixture must unpack");
  const rows = packed.rows;

  it("always carries numeric imported_done and overdue_open", () => {
    expect(
      rows.every(
        (r) =>
          typeof r.importedDone === "number" &&
          typeof r.overdueOpen === "number",
      ),
    ).toBe(true);
  });

  it("shows the overdue trend (the column is known, zeros included)", () => {
    const t = kpiTrends(rows, null, "2026-09-29", 16);
    expect(t.overdue?.points).toEqual([0, 1, 1, 2]);
  });

  it("lets the forecast say completions were imported", () => {
    const series = burnSeries(rows, null, "2026-09-29");
    const f = burnForecast(series, 16, { importedKnown: true })!;
    expect(f.importedKnown).toBe(true);
    expect(f.importedDone).toBe(3);
    expect(forecastReading(f)).toContain(
      "3 items arrived already done and are left out of the pace.",
    );
  });
});
