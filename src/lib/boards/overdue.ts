// Pure render-time overdue/completeness predicates. Spec (status intelligence,
// descoped 2026-07-03): complete ⇔ the board's FIRST status column holds an
// option labeled /done|complete/i; overdue ⇔ (end ?? date) < viewer-local
// today (strict ISO string compare) AND incomplete. Zero-schema by product
// decision — nothing is persisted; the tint is derived on every render from
// the board payload already in the cache (0 extra round-trips, gotcha-09).
import type { CacheCellValue, CacheColumn } from "@/lib/boards/cache";

const DONE_LABEL = /done|complete/i;

/** Viewer-local `YYYY-MM-DD` (not UTC — "overdue" follows the viewer's wall clock). */
export function localTodayISO(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Complete ⇔ the item's cell in the board's FIRST status column (by position)
 * holds an option whose label matches /done|complete/i. No status column, no
 * cell, or a non-done option ⇒ incomplete.
 */
export function isItemComplete(
  itemId: string,
  columns: Pick<CacheColumn, "id" | "kind" | "position" | "settings">[],
  cellValues: CacheCellValue[],
): boolean {
  const statusCol = columns
    .filter((c) => c.kind === "status")
    .sort((a, b) => a.position - b.position)[0];
  if (!statusCol) return false;
  const cell = cellValues.find(
    (v) => v.item_id === itemId && v.column_id === statusCol.id,
  );
  const optionId =
    cell && typeof cell.value === "object" && cell.value !== null
      ? (cell.value as { optionId?: string | null }).optionId
      : null;
  if (!optionId) return false;
  const options =
    (statusCol.settings as { options?: { id: string; label: string }[] })
      ?.options ?? [];
  const option = options.find((o) => o.id === optionId);
  return option ? DONE_LABEL.test(option.label) : false;
}

/**
 * Overdue ⇔ due (`end ?? date`) is strictly before `todayISO`. ISO `YYYY-MM-DD`
 * strings compare correctly as strings; missing/malformed values are never
 * overdue.
 */
export function isOverdue(value: unknown, todayISO: string): boolean {
  if (typeof value !== "object" || value === null) return false;
  const { date, end } = value as { date?: unknown; end?: unknown };
  const due =
    typeof end === "string" ? end : typeof date === "string" ? date : null;
  return due !== null && due < todayISO;
}
