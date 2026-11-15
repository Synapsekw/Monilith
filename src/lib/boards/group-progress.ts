import {
  cellKey,
  type CacheCellValue,
  type CacheColumn,
} from "@/lib/boards/cache";
import { isStatusValueComplete } from "@/lib/boards/overdue";

export type GroupProgress = { done: number; total: number; percent: number };

/**
 * How much of a group is done, for the group row's progress meter.
 *
 * "Done" is NOT a second rule: it is `isStatusValueComplete` over the board's
 * FIRST status column — the same pair Board Intelligence's overdue signal and
 * the date cells' overdue tint use (@/lib/boards/overdue). Pass the column the
 * table already resolved once (`controls.statusColumn`).
 *
 * `null` means "show no meter": the board has no status column, or the group
 * has no rows to measure. Pure; reads only the cells of the ids it is given.
 */
export function groupProgress(
  itemIds: readonly string[],
  statusColumn: Pick<CacheColumn, "id" | "settings"> | null,
  cellMap: ReadonlyMap<string, CacheCellValue["value"]>,
): GroupProgress | null {
  if (!statusColumn || itemIds.length === 0) return null;
  let done = 0;
  for (const id of itemIds) {
    const value = cellMap.get(cellKey(id, statusColumn.id)) ?? null;
    if (isStatusValueComplete(value, statusColumn)) done++;
  }
  return {
    done,
    total: itemIds.length,
    percent: Math.round((done / itemIds.length) * 100),
  };
}
