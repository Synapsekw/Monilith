import { describe, it, expect, vi } from "vitest";
import { buildCalendarMonth, onEventDropped } from "@/lib/boards/calendar";

const items = [
  { id: "i1", name: "A" },
  { id: "i2", name: "B" },
] as never;
const cells = [
  {
    item_id: "i1",
    column_id: "d1",
    value: { date: "2026-06-10", end: "2026-06-11" },
  },
  { item_id: "i2", column_id: "d1", value: { date: "2026-06-15" } },
] as never;

describe("buildCalendarMonth", () => {
  const month = buildCalendarMonth("2026-06-01", items, cells, "d1");
  it("produces 6 weeks of 7 days", () => {
    expect(month.weeks).toHaveLength(6);
    expect(month.weeks.every((w) => w.length === 7)).toBe(true);
  });
  it("places an event on its start day with the right span", () => {
    const day10 = month.weeks.flat().find((d) => d.dateISO === "2026-06-10")!;
    const ev = day10.events.find((e) => e.itemId === "i1")!;
    expect(ev).toMatchObject({ startsHere: true, spanDays: 2 });
  });
  it("marks out-of-month days", () => {
    expect(month.weeks.flat().filter((d) => !d.inMonth).length).toBeGreaterThan(
      0,
    );
  });
});

describe("onEventDropped", () => {
  it("moves the date and preserves duration", () => {
    const setCell = vi.fn();
    onEventDropped(
      "i1",
      "2026-06-10",
      "2026-06-12",
      { start: "2026-06-10", end: "2026-06-11" },
      "d1",
      setCell,
    );
    expect(setCell).toHaveBeenCalledWith({
      itemId: "i1",
      columnId: "d1",
      value: { date: "2026-06-12", end: "2026-06-13" },
    });
  });
});

import {
  packLanes,
  layOutWeek,
  weekStartOnOrBefore,
  type WeekInterval,
} from "@/lib/boards/calendar";

describe("packLanes", () => {
  const iv = (over: Partial<WeekInterval>): WeekInterval => ({
    itemId: "x",
    name: "x",
    startCol: 1,
    endCol: 1,
    continuesLeft: false,
    continuesRight: false,
    isSingle: true,
    ...over,
  });

  it("puts non-overlapping intervals on lane 0", () => {
    const out = packLanes([
      iv({ itemId: "a", startCol: 1, endCol: 2 }),
      iv({ itemId: "b", startCol: 4, endCol: 5 }),
    ]);
    expect(out.every((p) => p.lane === 0)).toBe(true);
  });

  it("stacks overlapping intervals onto separate lanes", () => {
    const out = packLanes([
      iv({ itemId: "a", startCol: 1, endCol: 4 }),
      iv({ itemId: "b", startCol: 2, endCol: 5 }),
    ]);
    const lanes = Object.fromEntries(out.map((p) => [p.itemId, p.lane]));
    expect(lanes.a).toBe(0);
    expect(lanes.b).toBe(1);
  });

  it("reuses a freed lane once an interval has ended", () => {
    const out = packLanes([
      iv({ itemId: "a", startCol: 1, endCol: 2 }),
      iv({ itemId: "b", startCol: 1, endCol: 7 }),
      iv({ itemId: "c", startCol: 4, endCol: 5 }),
    ]);
    const lanes = Object.fromEntries(out.map((p) => [p.itemId, p.lane]));
    // a(lane0,cols1-2) frees lane0 before c(cols4-5); b takes lane1.
    expect(lanes.a).toBe(0);
    expect(lanes.b).toBe(1);
    expect(lanes.c).toBe(0);
  });
});

describe("layOutWeek", () => {
  const items = [
    { id: "i1", name: "Span" },
    { id: "i2", name: "Single" },
  ];
  // Week of Sun 2026-06-07 .. Sat 2026-06-13
  const cells = [
    {
      item_id: "i1",
      column_id: "d1",
      value: { date: "2026-06-05", end: "2026-06-09" },
    },
    { item_id: "i2", column_id: "d1", value: { date: "2026-06-10" } },
  ] as never;

  it("clips a span that started before the week and flags continuesLeft", () => {
    const out = layOutWeek("2026-06-07", items, cells, "d1");
    const span = out.find((p) => p.itemId === "i1")!;
    expect(span.startCol).toBe(1); // clipped to Sunday
    expect(span.endCol).toBe(3); // 2026-06-09 = Tuesday
    expect(span.continuesLeft).toBe(true);
    expect(span.continuesRight).toBe(false);
    expect(span.isSingle).toBe(false);
  });

  it("places a single-day item in one column flagged isSingle", () => {
    const out = layOutWeek("2026-06-07", items, cells, "d1");
    const single = out.find((p) => p.itemId === "i2")!;
    expect(single.startCol).toBe(4); // 2026-06-10 = Wednesday
    expect(single.endCol).toBe(4);
    expect(single.isSingle).toBe(true);
  });

  it("excludes items outside the week", () => {
    const out = layOutWeek("2026-06-14", items, cells, "d1");
    expect(out).toHaveLength(0);
  });
});

describe("weekStartOnOrBefore", () => {
  it("returns the Sunday on or before a date", () => {
    expect(weekStartOnOrBefore("2026-06-10")).toBe("2026-06-07"); // Wed -> Sun
    expect(weekStartOnOrBefore("2026-06-07")).toBe("2026-06-07"); // Sun -> itself
  });
});
