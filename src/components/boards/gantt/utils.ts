import type { CSSProperties } from "react";
import { effectivePriority } from "@/lib/boards/priority";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// The name-rail bounds live in the lib (the server-side view schema needs them
// too); re-exported so existing component imports keep working.
export { DEFAULT_LABEL_W, LABEL_W_MIN, LABEL_W_MAX } from "@/lib/boards/gantt";
// One height for EVERY row kind (item, sub-item, section band): the arrow
// overlay and the rows-area height both compute from index * ROW_H.
export const ROW_H = 32;
export const BAR_H = 20; // px bar height
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

/**
 * Pixels-per-day for the grid, stretched so a short date range fills the
 * available track width instead of leaving dead space to the right. The zoom's
 * base scale is a *floor*: when the range already overflows the track, the base
 * wins and the grid scrolls; when it's shorter, px/day grows to fill exactly.
 * Returns the base untouched before the track has been measured (trackWidth 0).
 */
export function fittedDayW(
  baseDayW: number,
  trackWidth: number,
  dayCount: number,
): number {
  if (trackWidth <= 0 || dayCount <= 0) return baseDayW;
  return Math.max(baseDayW, trackWidth / dayCount);
}

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

// ---------------------------------------------------------------------------
// Today anchor + weekend shading
// ---------------------------------------------------------------------------

/** Share of the visible track left of today when a timeline opens: a little
 * recent past for context, most of the screen for what is coming. */
export const TODAY_ANCHOR = 0.34;

/** scrollLeft that puts today TODAY_ANCHOR of the way across the visible
 * track. `trackWidth` is the scroller's width minus the sticky name rail. */
export function todayScrollLeft(
  todayOffset: number,
  dayW: number,
  trackWidth: number,
): number {
  return Math.max(
    0,
    Math.round(todayOffset * dayW - trackWidth * TODAY_ANCHOR),
  );
}

/**
 * Weekend shading for a track, as ONE repeating background: a seven-day tile
 * (Monday first) whose last two days are tinted, shifted by the weekday the
 * range starts on. Week and Month zoom only — at Quarter and Year a day is 4px
 * or less and the stripes would be noise. The tint is the alpha-on-parent
 * hover token, so it reads on every surface, theme and reach.
 */
export function weekendStripes(
  rangeStartISO: string,
  dayW: number,
  zoom: TimelineZoom,
): CSSProperties | undefined {
  if (!rangeStartISO || (zoom !== "week" && zoom !== "month")) return undefined;
  const sinceMonday = (new Date(parseISO(rangeStartISO)).getUTCDay() + 6) % 7;
  const workdays = 5 * dayW;
  return {
    backgroundImage: `linear-gradient(to right, transparent ${workdays}px, var(--color-state-hover) ${workdays}px)`,
    backgroundSize: `${7 * dayW}px 100%`,
    backgroundPosition: `${-sinceMonday * dayW}px 0`,
  };
}

// ---------------------------------------------------------------------------
// Bar labels
// ---------------------------------------------------------------------------

/** The inside label's own horizontal padding (`px-2`, both sides). */
export const BAR_LABEL_PAD = 16;
/** The resize strip at the end of an editable bar (`w-2`). */
export const BAR_RESIZE_W = 8;
/** Space between a bar's edge and the label drawn beside it. */
export const OUTSIDE_LABEL_GAP = 6;

/**
 * Does the name fit inside the bar? Decided from pixels — the bar's width
 * against the measured text — never from character counts. An unmeasured name
 * (0: no canvas) counts as fitting, which keeps the CSS-truncated label.
 */
export function barLabelFits(
  barWidthPx: number,
  textWidthPx: number,
  editable: boolean,
): boolean {
  if (textWidthPx <= 0) return true;
  return (
    textWidthPx + BAR_LABEL_PAD + (editable ? BAR_RESIZE_W : 0) <= barWidthPx
  );
}

/** "Oct 24" from YYYY-MM-DD, in UTC so the day never drifts. */
export function formatShortDay(iso: string): string {
  return new Date(parseISO(iso)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * The short label drawn beside a bar, or null for none. The name is already
 * in the rail on the same row, so beside the bar goes what is missing: how
 * late the item is, or — when the bar is too short to carry its name, and for
 * a milestone, which has no inside label — its end date.
 */
export function outsideBarLabel(a: {
  lateDays: number | null;
  insideFits: boolean;
  isMilestone: boolean;
  endISO: string | undefined;
}): { text: string; late: boolean } | null {
  if (a.lateDays !== null) return { text: `${a.lateDays}d late`, late: true };
  if ((a.insideFits && !a.isMilestone) || !a.endISO) return null;
  return { text: formatShortDay(a.endISO), late: false };
}

/**
 * Which side of the bar the outside label goes on. After the bar by default;
 * before it when cross-board link stubs already hold the after side or the
 * label would clip the track; null (not drawn) when neither side has room.
 */
export function outsideLabelSide(a: {
  barStartX: number;
  barEndX: number;
  trackW: number;
  labelW: number;
  afterTaken: boolean;
  beforeTaken: boolean;
}): "after" | "before" | null {
  const need = a.labelW + OUTSIDE_LABEL_GAP;
  if (!a.afterTaken && a.barEndX + need <= a.trackW) return "after";
  if (!a.beforeTaken && a.barStartX - need >= 0) return "before";
  return null;
}
