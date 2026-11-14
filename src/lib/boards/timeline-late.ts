// "Late" for the board timeline. Built from the SAME primitives the Board
// Intelligence overdue chip uses (`overdueSignals` in intelligence/signals.ts):
// an item is late when it is open — its cell in the board's first status
// column is not a done/complete option — and ANY date-kind column holds a due
// date before the viewer's local today. timeline-late.test.ts pins the two
// together, so the bars and the chip cannot disagree.
import { cellKey, type CacheColumn } from "@/lib/boards/cache";
import { diffDaysISO } from "@/lib/boards/calendar";
import {
  dueISO,
  firstStatusColumn,
  isOverdue,
  isStatusValueComplete,
} from "@/lib/boards/overdue";

export type TimelineLate = {
  /** itemId → whole days since its earliest past-due date. Late items only. */
  lateDays: Map<string, number>;
  /** The chip's completeness rule, for the group summary's done share. */
  isDone: (itemId: string) => boolean;
};

export function buildTimelineLate(input: {
  items: readonly { id: string }[];
  columns: readonly CacheColumn[];
  cellMap: ReadonlyMap<string, unknown>;
  todayISO: string;
}): TimelineLate {
  const statusColumn = firstStatusColumn(input.columns);
  const isDone = (itemId: string) =>
    isStatusValueComplete(
      statusColumn
        ? (input.cellMap.get(cellKey(itemId, statusColumn.id)) ?? null)
        : null,
      statusColumn,
    );
  const dateColumns = input.columns.filter((c) => c.kind === "date");
  const lateDays = new Map<string, number>();
  for (const it of input.items) {
    if (isDone(it.id)) continue;
    let earliest: string | null = null;
    for (const col of dateColumns) {
      const value = input.cellMap.get(cellKey(it.id, col.id));
      if (!isOverdue(value, input.todayISO)) continue;
      const due = dueISO(value);
      if (due !== null && (earliest === null || due < earliest)) earliest = due;
    }
    if (earliest === null) continue;
    // A malformed-but-"earlier" string still counts as late for the chip, so
    // it stays in the set here too; it just reads as one day.
    const days = diffDaysISO(earliest, input.todayISO);
    lateDays.set(it.id, Number.isFinite(days) && days > 0 ? days : 1);
  }
  return { lateDays, isDone };
}
