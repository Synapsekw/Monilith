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

/** The status column a board's completeness is read from: lowest position wins. */
type StatusColumn = Pick<CacheColumn, "id" | "kind" | "position" | "settings">;

/**
 * The board's FIRST status column (by position), or `null` when it has none.
 *
 * Hoisted out of {@link isItemComplete} so the table can resolve it ONCE per
 * render (a `useMemo` over `columns`) instead of re-deriving it — filter + sort
 * over every column — inside every visible date cell.
 */
export function firstStatusColumn<T extends StatusColumn>(
  columns: readonly T[],
): T | null {
  let first: T | null = null;
  for (const c of columns) {
    if (c.kind !== "status") continue;
    if (!first || c.position < first.position) first = c;
  }
  return first;
}

/**
 * Complete ⇔ `value` — the item's cell value in `statusColumn` — holds an
 * option whose label matches /done|complete/i. The O(1) form of
 * {@link isItemComplete}: callers that already hold the cell (via the table's
 * `cellMap`) and the resolved status column pass them straight in, instead of
 * scanning every cell value on the board per date cell.
 */
export function isStatusValueComplete(
  value: unknown,
  statusColumn: Pick<CacheColumn, "settings"> | null,
): boolean {
  if (!statusColumn) return false;
  const optionId =
    typeof value === "object" && value !== null
      ? (value as { optionId?: string | null }).optionId
      : null;
  if (!optionId) return false;
  const options =
    (statusColumn.settings as { options?: { id: string; label: string }[] })
      ?.options ?? [];
  const option = options.find((o) => o.id === optionId);
  return option ? DONE_LABEL.test(option.label) : false;
}

/**
 * Complete ⇔ the item's cell in the board's FIRST status column (by position)
 * holds an option whose label matches /done|complete/i. No status column, no
 * cell, or a non-done option ⇒ incomplete.
 *
 * O(all cell values). Kept as the standalone predicate for callers that hold
 * only a raw board payload; render hot paths use
 * {@link firstStatusColumn} + {@link isStatusValueComplete} instead.
 */
export function isItemComplete(
  itemId: string,
  columns: StatusColumn[],
  cellValues: CacheCellValue[],
): boolean {
  const statusCol = firstStatusColumn(columns);
  if (!statusCol) return false;
  const cell = cellValues.find(
    (v) => v.item_id === itemId && v.column_id === statusCol.id,
  );
  return isStatusValueComplete(cell?.value ?? null, statusCol);
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
