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
