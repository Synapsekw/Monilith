import type { CacheCellValue } from "@/lib/boards/cache";
import { itemDateRange } from "@/lib/boards/dates";

// ---------------------------------------------------------------------------
// Date math helpers (no argless new Date() / Date.now())
// ---------------------------------------------------------------------------

/** Parse a YYYY-MM-DD string into a UTC timestamp (ms). */
function parseISO(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Format a UTC timestamp (ms) back to YYYY-MM-DD. */
function formatISO(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Add n days to a YYYY-MM-DD string. */
export function addDaysISO(iso: string, n: number): string {
  const MS_PER_DAY = 86_400_000;
  return formatISO(parseISO(iso) + n * MS_PER_DAY);
}

/** Difference in days: how many days from aISO to bISO (bISO - aISO). */
export function diffDaysISO(aISO: string, bISO: string): number {
  const MS_PER_DAY = 86_400_000;
  return Math.round((parseISO(bISO) - parseISO(aISO)) / MS_PER_DAY);
}

// ---------------------------------------------------------------------------
// Calendar types
// ---------------------------------------------------------------------------

export type CalendarEvent = {
  itemId: string;
  name: string;
  startsHere: boolean;
  spanDays: number;
};

export type CalendarDay = {
  dateISO: string;
  inMonth: boolean;
  events: CalendarEvent[];
};

export type CalendarMonth = {
  weeks: CalendarDay[][];
};

// ---------------------------------------------------------------------------
// buildCalendarMonth
// ---------------------------------------------------------------------------

/**
 * Build a 6×7 grid starting on the Sunday on/before the 1st of the month
 * indicated by monthISO (any YYYY-MM-DD string within that month works,
 * but the 1st of the month is the canonical input).
 */
export function buildCalendarMonth(
  monthISO: string,
  items: { id: string; name: string }[],
  cellValues: CacheCellValue[],
  dateColumnId: string,
): CalendarMonth {
  // Determine month boundaries
  const [year, month] = monthISO.split("-").map(Number);
  const firstOfMonth = formatISO(Date.UTC(year, month - 1, 1));

  // Find the Sunday on/before the 1st
  const firstMs = parseISO(firstOfMonth);
  const firstDayOfWeek = new Date(firstMs).getUTCDay(); // 0 = Sunday
  const gridStartMs = firstMs - firstDayOfWeek * 86_400_000;

  // Build 6 weeks × 7 days = 42 days total
  const weeks: CalendarDay[][] = [];
  for (let week = 0; week < 6; week++) {
    const weekDays: CalendarDay[] = [];
    for (let day = 0; day < 7; day++) {
      const idx = week * 7 + day;
      const dayMs = gridStartMs + idx * 86_400_000;
      const dayISO = formatISO(dayMs);
      const dayDate = new Date(dayMs);
      const inMonth =
        dayDate.getUTCFullYear() === year &&
        dayDate.getUTCMonth() + 1 === month;
      weekDays.push({ dateISO: dayISO, inMonth, events: [] });
    }
    weeks.push(weekDays);
  }

  // Build a flat lookup: dateISO -> CalendarDay
  const dayMap = new Map<string, CalendarDay>();
  for (const week of weeks) {
    for (const day of week) {
      dayMap.set(day.dateISO, day);
    }
  }

  // Place events
  for (const item of items) {
    const range = itemDateRange(item.id, cellValues, dateColumnId);
    if (!range) continue;
    const spanDays = diffDaysISO(range.start, range.end) + 1;
    for (let i = 0; i < spanDays; i++) {
      const dayISO = addDaysISO(range.start, i);
      const calDay = dayMap.get(dayISO);
      if (!calDay) continue;
      calDay.events.push({
        itemId: item.id,
        name: item.name,
        startsHere: i === 0,
        spanDays,
      });
    }
  }

  return { weeks };
}

// ---------------------------------------------------------------------------
// onEventDropped
// ---------------------------------------------------------------------------

export type SetCellArg = {
  itemId: string;
  columnId: string;
  value: { date: string; end: string };
};

/**
 * When an event is dragged from fromDayISO to toDayISO, shift both start and
 * end of the current range by the same delta, preserving duration.
 */
export function onEventDropped(
  itemId: string,
  fromDayISO: string,
  toDayISO: string,
  currentRange: { start: string; end: string },
  dateColumnId: string,
  setCell: (arg: SetCellArg) => void,
): void {
  const delta = diffDaysISO(fromDayISO, toDayISO);
  const newStart = addDaysISO(currentRange.start, delta);
  const newEnd = addDaysISO(currentRange.end, delta);
  setCell({
    itemId,
    columnId: dateColumnId,
    value: { date: newStart, end: newEnd },
  });
}
