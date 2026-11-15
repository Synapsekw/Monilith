import { cellKey, type CacheCellValue } from "@/lib/boards/cache";
import {
  isStatusValueComplete,
  type BoardWorkRule,
} from "@/lib/boards/overdue";

export type GroupProgress = { done: number; total: number; percent: number };

/**
 * How much of a group is done, for the group row's progress meter.
 *
 * "Done" is NOT a second rule: it is `isStatusValueComplete` under the board's
 * Work tracking rule: the same rule Board Intelligence's overdue signal, the
 * date cells' overdue tint, Today and the folder pages use
 * (@/lib/boards/overdue). Pass the rule the table already resolved once
 * (`controls.workRule`).
 *
 * `null` means "show no meter": the rule has no status column, or the group
 * has no rows to measure. Pure; reads only the cells of the ids it is given.
 */
export function groupProgress(
  itemIds: readonly string[],
  rule: Pick<BoardWorkRule, "statusColumn" | "doneOptionIds"> | null,
  cellMap: ReadonlyMap<string, CacheCellValue["value"]>,
): GroupProgress | null {
  const statusColumn = rule?.statusColumn ?? null;
  if (!rule || !statusColumn || itemIds.length === 0) return null;
  let done = 0;
  for (const id of itemIds) {
    const value = cellMap.get(cellKey(id, statusColumn.id)) ?? null;
    if (isStatusValueComplete(value, rule)) done++;
  }
  return {
    done,
    total: itemIds.length,
    percent: Math.round((done / itemIds.length) * 100),
  };
}
