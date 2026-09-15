import { describe, expect, it } from "vitest";
import { buildStages } from "./stages";
import {
  band,
  boardHealth,
  boardSummaries,
  burnSeries,
  carryOver,
  computeKpis,
  daysBetween,
  filterRows,
  nextMilestones,
  onlyOnOneBoard,
  stageMatrix,
} from "./rollup";
import { FIXTURE_TODAY, folderFixture } from "./fixture";
import type { BurnRow } from "./types";

const fx = folderFixture();
const rows = fx.rollup!;
const stages = buildStages(rows, FIXTURE_TODAY);

describe("computeKpis", () => {
  it("sums buckets and derives percent, gap and oldest overdue age", () => {
    const k = computeKpis(rows, FIXTURE_TODAY);
    expect(k.total).toBe(rows.reduce((s, r) => s + r.total, 0));
    expect(k.done).toBe(rows.reduce((s, r) => s + r.done, 0));
    expect(k.donePct).toBe(Math.round((k.done / k.total) * 100));
    expect(k.gap).toBe(k.done - k.plannedByToday);
    expect(k.oldestOverdueDays).toBe(daysBetween("2026-09-01", FIXTURE_TODAY)); // fixture's oldest
  });

  it("reports null percent/gap with no items or no due dates", () => {
    expect(computeKpis([], FIXTURE_TODAY)).toMatchObject({
      donePct: null,
      gap: null,
      oldestOverdueDays: null,
    });
    const noDates = rows.map((r) => ({
      ...r,
      minDue: null,
      maxDue: null,
      plannedByToday: 0,
      oldestOverdue: null,
    }));
    expect(computeKpis(noDates, FIXTURE_TODAY).gap).toBeNull();
  });

  it("gap sign: negative when behind plan, positive when ahead", () => {
    const behind = [{ ...rows[0], done: 1, plannedByToday: 4 }];
    const ahead = [{ ...rows[0], done: 4, plannedByToday: 1 }];
    expect(computeKpis(behind, FIXTURE_TODAY).gap).toBe(-3);
    expect(computeKpis(ahead, FIXTURE_TODAY).gap).toBe(3);
  });
});

describe("filterRows", () => {
  it("filters by stage key and board id", () => {
    const only = filterRows(rows, { stageKey: "build", boardId: "b1" });
    expect(
      only.every(
        (r) => r.boardId === "b1" && r.groupName?.toLowerCase() === "build",
      ),
    ).toBe(true);
    expect(filterRows(rows, { stageKey: null, boardId: null })).toEqual(rows);
  });
});

describe("boardHealth", () => {
  it("applies the thresholds", () => {
    expect(
      boardHealth({ total: 10, overdue: 0, blocked: 0, incomplete: 0 }),
    ).toBe("on_track");
    expect(
      boardHealth({ total: 10, overdue: 1, blocked: 0, incomplete: 0 }),
    ).toBe("at_risk");
    expect(
      boardHealth({ total: 10, overdue: 0, blocked: 0, incomplete: 6 }),
    ).toBe("at_risk");
    expect(
      boardHealth({ total: 10, overdue: 2, blocked: 1, incomplete: 0 }),
    ).toBe("off_track");
    expect(
      boardHealth({ total: 0, overdue: 0, blocked: 0, incomplete: 0 }),
    ).toBe("on_track");
  });
});

describe("boardSummaries + stageMatrix + band", () => {
  it("lists every board even with zero rollup rows", () => {
    const s = boardSummaries(
      rows,
      [...fx.boards, { id: "ghost", name: "Ghost", position: 9 }],
      stages,
    );
    expect(s.map((b) => b.id)).toContain("ghost");
    expect(s.find((b) => b.id === "ghost")).toMatchObject({
      total: 0,
      donePct: null,
      health: "on_track",
    });
  });

  it("matrix cells are percent done or null when the board lacks the stage", () => {
    const m = stageMatrix(rows);
    expect(m.get("b1")?.get("build")).toBe(50);
    expect(m.get("b3")?.get("qa")).toBeNull();
  });

  it("bands: >=90 green, >=50 blue, >=25 yellow, else gray", () => {
    expect(band(90)).toBe("green");
    expect(band(50)).toBe("blue");
    expect(band(25)).toBe("yellow");
    expect(band(24)).toBe("gray");
  });
});

describe("milestones + carry-over + only-on-one-board", () => {
  it("returns the next three stage end dates with open items before each", () => {
    const ms = nextMilestones(stages, FIXTURE_TODAY, 3);
    expect(ms.length).toBeLessThanOrEqual(3);
    expect(ms.every((m) => m.endDate >= FIXTURE_TODAY)).toBe(true);
    expect(ms.map((m) => m.endDate)).toEqual(
      [...ms.map((m) => m.endDate)].sort(),
    );
  });

  it("counts open items in stages that are complete elsewhere", () => {
    // fixture: "qa" is complete on b1 (2/2) but b2 still has 1 open in qa
    expect(carryOver(rows, stages)).toBe(1);
  });

  it("lists groups no other board shares", () => {
    expect(onlyOnOneBoard(rows, stages)).toEqual([
      {
        groupId: "b3:launch",
        groupName: "Launch",
        boardId: "b3",
        boardName: "Website",
      },
    ]);
  });
});

describe("burnSeries", () => {
  const burn: BurnRow[] = [
    { stageKey: "build", weekStart: "2026-08-31", planned: 2, completed: 1 },
    { stageKey: "build", weekStart: "2026-09-07", planned: 1, completed: 0 },
    { stageKey: "build", weekStart: "2026-09-14", planned: 0, completed: 2 },
    { stageKey: "qa", weekStart: "2026-08-31", planned: 0, completed: 0 },
    { stageKey: "qa", weekStart: "2026-09-07", planned: 3, completed: 1 },
    { stageKey: "qa", weekStart: "2026-09-14", planned: 0, completed: 0 },
  ];
  it("sums stages per week when no stage is selected and accumulates", () => {
    const pts = burnSeries(burn, null, FIXTURE_TODAY);
    expect(pts.map((p) => p.weekStart)).toEqual([
      "2026-08-31",
      "2026-09-07",
      "2026-09-14",
    ]);
    expect(pts.map((p) => p.planned)).toEqual([2, 4, 0]);
    expect(pts.map((p) => p.plannedCum)).toEqual([2, 6, 6]);
    expect(pts.map((p) => p.completedCum)).toEqual([1, 2, 4]);
    expect(pts.map((p) => p.isPast)).toEqual([true, true, true]); // week of today counts as past
  });
  it("scopes to one stage", () => {
    expect(burnSeries(burn, "qa", FIXTURE_TODAY).map((p) => p.planned)).toEqual(
      [0, 3, 0],
    );
  });
});
