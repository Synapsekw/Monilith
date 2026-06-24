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

// ---------------------------------------------------------------------------
// Lane packing (Month / Week views)
// ---------------------------------------------------------------------------

export type WeekInterval = {
  itemId: string;
  name: string;
  /** 1-based column, Sun=1 .. Sat=7, clipped to the visible week. */
  startCol: number;
  endCol: number;
  /** True when the real range began before this week's Sunday. */
  continuesLeft: boolean;
  /** True when the real range ends after this week's Saturday. */
  continuesRight: boolean;
  /** True when the item's real range is a single day (start === end). */
  isSingle: boolean;
};

export type PlacedInterval = WeekInterval & { lane: number };

/**
 * Greedy interval packing within one week. Sort by (startCol asc, endCol asc,
 * itemId) for determinism — shorter intervals first among equal starts, so a
 * brief item frees its lane for a later one in the same week — then assign each
 * interval the lowest lane whose last occupant ends before this one starts.
 */
export function packLanes(intervals: WeekInterval[]): PlacedInterval[] {
  const sorted = [...intervals].sort(
    (a, b) =>
      a.startCol - b.startCol ||
      a.endCol - b.endCol ||
      a.itemId.localeCompare(b.itemId),
  );
  const laneEnd: number[] = []; // last endCol occupied per lane
  const placed: PlacedInterval[] = [];
  for (const iv of sorted) {
    let lane = 0;
    while (laneEnd[lane] !== undefined && laneEnd[lane] >= iv.startCol) lane++;
    laneEnd[lane] = iv.endCol;
    placed.push({ ...iv, lane });
  }
  return placed;
}

/** The Sunday on or before dateISO (YYYY-MM-DD). */
export function weekStartOnOrBefore(dateISO: string): string {
  const dow = new Date(parseISO(dateISO)).getUTCDay(); // 0 = Sunday
  return addDaysISO(dateISO, -dow);
}

/**
 * Lay out every item whose date range overlaps the 7-day week beginning at
 * weekStartISO (a Sunday). Returns packed lane assignments for rendering bars
 * with CSS-grid column spans.
 */
export function layOutWeek(
  weekStartISO: string,
  items: { id: string; name: string }[],
  cellValues: CacheCellValue[],
  dateColumnId: string,
): PlacedInterval[] {
  const weekEndISO = addDaysISO(weekStartISO, 6);
  const intervals: WeekInterval[] = [];
  for (const item of items) {
    const range = itemDateRange(item.id, cellValues, dateColumnId);
    if (!range) continue;
    if (range.end < weekStartISO || range.start > weekEndISO) continue; // no overlap
    const startOffset = diffDaysISO(weekStartISO, range.start); // may be < 0
    const endOffset = diffDaysISO(weekStartISO, range.end); // may be > 6
    intervals.push({
      itemId: item.id,
      name: item.name,
      startCol: Math.max(1, startOffset + 1),
      endCol: Math.min(7, endOffset + 1),
      continuesLeft: startOffset < 0,
      continuesRight: endOffset > 6,
      isSingle: range.start === range.end,
    });
  }
  return packLanes(intervals);
}
