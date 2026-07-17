import { effectivePriority } from "@/lib/boards/priority";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DAY_W = 28; // px per day column (Week zoom / geometry default)
export const LABEL_W = 200; // px for the left name rail
export const ROW_H = 40; // px per row
export const BAR_H = 24; // px bar height
export const MILESTONE = 13; // px milestone diamond (pre-rotation); centered in its day column
export const MIN_BAR_W = 6; // px floor so a bar stays visible/clickable at coarse zoom

export type TimelineZoom = "week" | "month" | "quarter" | "year";

// Pixels per day column, per zoom level. Week keeps the original detailed
// 28px/day; the coarser levels shrink the scale so a whole month / quarter /
// year fits on screen instead of requiring endless horizontal scrolling. Row
// geometry is day-offset × this value, so nothing downstream changes when it
// varies — only this multiplier does.
export const PX_PER_DAY: Record<TimelineZoom, number> = {
  week: 28,
  month: 10,
  quarter: 4,
  year: 1.5,
};

// Minimum grid width in days per zoom — the floor `timelineDayCount` extends to
// fit the real data range. Keeps a sparse board from collapsing to a sliver and
// gives each level a sensible default span (a month, a quarter, a year).
export const ZOOM_DAY_COUNT: Record<TimelineZoom, number> = {
  week: 28,
  month: 90,
  quarter: 180,
  year: 365,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse YYYY-MM-DD → UTC ms */
export function parseISO(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Format UTC ms → YYYY-MM-DD */
export function formatISO(ms: number): string {
  const d = new Date(ms);
  return [
    d.getUTCFullYear(),
    String(d.getUTCMonth() + 1).padStart(2, "0"),
    String(d.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

/** Generate month tick labels for the header */
export function buildMonthTicks(
  rangeStartISO: string,
  dayCount: number,
): { label: string; dayOffset: number }[] {
  const ticks: { label: string; dayOffset: number }[] = [];
  const startMs = parseISO(rangeStartISO);
  const endMs = startMs + dayCount * 86_400_000;

  // Find first day of month on/after range start
  const start = new Date(startMs);
  let cur = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  if (cur.getTime() < startMs) {
    cur = new Date(
      Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1),
    );
  }

  while (cur.getTime() < endMs) {
    const dayOffset = Math.round((cur.getTime() - startMs) / 86_400_000);
    const label = cur.toLocaleDateString("en-US", {
      month: "short",
      year: "2-digit",
      timeZone: "UTC",
    });
    ticks.push({ label, dayOffset });
    cur = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1));
  }

  return ticks;
}

/**
 * Generate quarter tick labels ("Q1 '26") for the header. Used at Year zoom
 * where monthly ticks would cram together — one tick per quarter boundary
 * (Jan/Apr/Jul/Oct) instead of one per month. Same shape as buildMonthTicks.
 */
export function buildQuarterTicks(
  rangeStartISO: string,
  dayCount: number,
): { label: string; dayOffset: number }[] {
  const ticks: { label: string; dayOffset: number }[] = [];
  const startMs = parseISO(rangeStartISO);
  const endMs = startMs + dayCount * 86_400_000;

  // First day of the quarter on/after range start.
  const start = new Date(startMs);
  const qMonth = Math.floor(start.getUTCMonth() / 3) * 3;
  let cur = new Date(Date.UTC(start.getUTCFullYear(), qMonth, 1));
  if (cur.getTime() < startMs) {
    cur = new Date(Date.UTC(start.getUTCFullYear(), qMonth + 3, 1));
  }

  while (cur.getTime() < endMs) {
    const dayOffset = Math.round((cur.getTime() - startMs) / 86_400_000);
    const quarter = Math.floor(cur.getUTCMonth() / 3) + 1;
    const yy = String(cur.getUTCFullYear()).slice(2);
    ticks.push({ label: `Q${quarter} '${yy}`, dayOffset });
    cur = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 3, 1));
  }

  return ticks;
}

/** Today as YYYY-MM-DD */
export function todayISO(): string {
  const d = new Date();
  return formatISO(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

// ---------------------------------------------------------------------------
// Drag data shapes
// ---------------------------------------------------------------------------

export type BarDragData = {
  kind: "bar";
  itemId: string;
  startISO: string;
  endISO: string;
  startColumnId: string;
  endColumnId: string | null;
  startDayOffset: number;
};

/**
 * Name-rail marker label for an effective-critical item, or null when the item
 * is not critical. Same label strings as PriorityCell so the tooltip/sr text
 * reads identically across views.
 */
export function effectiveCriticalLabel(
  value: unknown,
  dependents: number,
): string | null {
  const { level, auto } = effectivePriority(value, dependents);
  if (level !== "critical") return null;
  return auto
    ? `Critical (auto) — ${dependents} items depend on this`
    : "Critical";
}
