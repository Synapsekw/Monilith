import { describe, it, expect } from "vitest";
import {
  PX_PER_DAY,
  buildQuarterTicks,
  buildMonthTicks,
  fittedDayW,
  ROW_H,
  BAR_H,
  DEFAULT_LABEL_W,
  LABEL_W_MIN,
  LABEL_W_MAX,
  todayScrollLeft,
  weekendStripes,
} from "@/components/boards/gantt/utils";

describe("fittedDayW", () => {
  it("stretches px/day so a short range fills the available track width", () => {
    // 30 days over a 1200px track → 40px/day, well above the base scale.
    expect(fittedDayW(10, 1200, 30)).toBe(40);
  });

  it("keeps the zoom's base scale when the range already overflows the track", () => {
    // 365 days at 28px/day = 10220px ≫ 1200px track → no stretch, scrolls.
    expect(fittedDayW(28, 1200, 365)).toBe(28);
  });

  it("never returns below the base scale (base is a floor)", () => {
    expect(fittedDayW(4, 100, 365)).toBe(4);
  });

  it("falls back to the base scale before the track is measured", () => {
    expect(fittedDayW(1.5, 0, 365)).toBe(1.5);
  });

  it("guards against a zero day count", () => {
    expect(fittedDayW(10, 1200, 0)).toBe(10);
  });
});

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

describe("row geometry constants", () => {
  it("uses compact rows and a 300px default rail clamped to 160–520", () => {
    expect(ROW_H).toBe(32);
    expect(BAR_H).toBe(20);
    expect(DEFAULT_LABEL_W).toBe(300);
    expect([LABEL_W_MIN, LABEL_W_MAX]).toEqual([160, 520]);
  });
});

describe("todayScrollLeft", () => {
  it("puts today 34% of the way across the visible track", () => {
    expect(todayScrollLeft(200, 10, 1000)).toBe(1660);
  });
  it("never scrolls to a negative offset", () => {
    expect(todayScrollLeft(10, 10, 1000)).toBe(0);
  });
});

describe("weekendStripes", () => {
  it("shades Saturday and Sunday on a Monday-first seven-day tile", () => {
    // 2026-11-02 is a Monday.
    expect(weekendStripes("2026-11-02", 10, "month")).toEqual({
      backgroundImage:
        "linear-gradient(to right, transparent 50px, var(--color-state-hover) 50px)",
      backgroundSize: "70px 100%",
      backgroundPosition: "0px 0",
    });
  });
  it("offsets the tile by the weekday the range starts on", () => {
    // 2026-11-01 is a Sunday: six days after Monday, at 28px a day.
    expect(weekendStripes("2026-11-01", 28, "week")?.backgroundPosition).toBe(
      "-168px 0",
    );
  });
  it("draws nothing at quarter and year zoom, or without a range", () => {
    expect(weekendStripes("2026-11-02", 4, "quarter")).toBeUndefined();
    expect(weekendStripes("2026-11-02", 1.5, "year")).toBeUndefined();
    expect(weekendStripes("", 10, "month")).toBeUndefined();
  });
});
