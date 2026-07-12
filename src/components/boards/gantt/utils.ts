import { effectivePriority } from "@/lib/boards/priority";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DAY_W = 28; // px per day column
export const LABEL_W = 200; // px for the left name rail
export const ROW_H = 40; // px per row
export const BAR_H = 24; // px bar height
export const MILESTONE = 13; // px milestone diamond (pre-rotation); centered in its day column

// Week → ~28 days, Month → ~90 days
export const ZOOM_DAY_COUNT: Record<"week" | "month", number> = {
  week: 28,
  month: 90,
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
