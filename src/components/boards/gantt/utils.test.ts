import { describe, it, expect } from "vitest";
import {
  PX_PER_DAY,
  buildQuarterTicks,
  buildMonthTicks,
} from "@/components/boards/gantt/utils";

describe("PX_PER_DAY", () => {
  it("defines a px/day scale for every zoom level", () => {
    expect(Object.keys(PX_PER_DAY).sort()).toEqual([
      "month",
      "quarter",
      "week",
      "year",
    ]);
  });

  it("keeps Week at the original detailed 28px/day scale", () => {
    expect(PX_PER_DAY.week).toBe(28);
  });

  it("zooms out monotonically week → month → quarter → year", () => {
    expect(PX_PER_DAY.week).toBeGreaterThan(PX_PER_DAY.month);
    expect(PX_PER_DAY.month).toBeGreaterThan(PX_PER_DAY.quarter);
    expect(PX_PER_DAY.quarter).toBeGreaterThan(PX_PER_DAY.year);
  });
});

describe("buildQuarterTicks", () => {
  it("emits one tick per quarter boundary, labelled Q# 'YY", () => {
    const ticks = buildQuarterTicks("2026-01-01", 365);
    expect(ticks.map((t) => t.label)).toEqual([
      "Q1 '26",
      "Q2 '26",
      "Q3 '26",
      "Q4 '26",
    ]);
    // Day offsets of the quarter starts within a non-leap year.
    expect(ticks.map((t) => t.dayOffset)).toEqual([0, 90, 181, 273]);
  });

  it("skips a partial leading quarter and starts on the next boundary", () => {
    const ticks = buildQuarterTicks("2026-02-15", 400);
    expect(ticks[0].label).toBe("Q2 '26");
    expect(ticks[0].dayOffset).toBeGreaterThan(0);
  });

  it("crosses a year boundary", () => {
    // Oct 1 → +120 days lands late January, covering Q4 '26 and Q1 '27 only.
    const ticks = buildQuarterTicks("2026-10-01", 120);
    expect(ticks.map((t) => t.label)).toEqual(["Q4 '26", "Q1 '27"]);
  });

  it("returns coarser ticks than buildMonthTicks over the same span", () => {
    const span = 365;
    expect(buildQuarterTicks("2026-01-01", span).length).toBeLessThan(
      buildMonthTicks("2026-01-01", span).length,
    );
  });
});
