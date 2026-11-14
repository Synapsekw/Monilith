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
  barLabelFits,
  formatShortDay,
  outsideBarLabel,
  outsideLabelSide,
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

describe("barLabelFits", () => {
  it("needs the text plus padding, plus the resize strip on an editable bar", () => {
    expect(barLabelFits(80, 64, false)).toBe(true); // 64 + 16
    expect(barLabelFits(80, 64, true)).toBe(false); // 64 + 16 + 8
    expect(barLabelFits(88, 64, true)).toBe(true);
  });
  it("treats an unmeasured name as fitting", () => {
    expect(barLabelFits(6, 0, true)).toBe(true);
  });
});

describe("formatShortDay", () => {
  it("prints month and day without drifting across time zones", () => {
    expect(formatShortDay("2026-10-24")).toBe("Oct 24");
    expect(formatShortDay("2026-01-01")).toBe("Jan 1");
  });
});

describe("outsideBarLabel", () => {
  const base = {
    lateDays: null,
    insideFits: true,
    isMilestone: false,
    endISO: "2026-10-24",
  };
  it("is nothing when the name fits and the item is on time", () => {
    expect(outsideBarLabel(base)).toBeNull();
  });
  it("is the end date when the name does not fit", () => {
    expect(outsideBarLabel({ ...base, insideFits: false })).toEqual({
      text: "Oct 24",
      late: false,
    });
  });
  it("is the date for a milestone, which has no inside label", () => {
    expect(outsideBarLabel({ ...base, isMilestone: true })?.text).toBe(
      "Oct 24",
    );
  });
  it("is 'Nd late' for a late item, even when the name fits", () => {
    expect(outsideBarLabel({ ...base, lateDays: 21 })).toEqual({
      text: "21d late",
      late: true,
    });
  });
});

describe("outsideLabelSide", () => {
  const base = {
    barStartX: 100,
    barEndX: 150,
    trackW: 300,
    labelW: 40,
    afterTaken: false,
    beforeTaken: false,
  };
  it("prefers the space after the bar", () => {
    expect(outsideLabelSide(base)).toBe("after");
  });
  it("goes before the bar when stubs hold the after side or it would clip", () => {
    expect(outsideLabelSide({ ...base, afterTaken: true })).toBe("before");
    expect(outsideLabelSide({ ...base, barEndX: 280 })).toBe("before");
  });
  it("is not drawn when neither side has room", () => {
    expect(
      outsideLabelSide({ ...base, barStartX: 10, barEndX: 290 }),
    ).toBeNull();
    expect(
      outsideLabelSide({ ...base, afterTaken: true, beforeTaken: true }),
    ).toBeNull();
  });
});
