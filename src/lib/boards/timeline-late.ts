// "Late" for the board timeline. Built from the SAME primitives the Board
// Intelligence overdue chip uses (`overdueSignals` in intelligence/signals.ts)
// and the same Work tracking rule as every other surface: an item is late
// when it is open (its cell in the rule's status column is not a done option)
// and the rule's ONE due column holds a date before the viewer's local today.
// timeline-late.test.ts pins the two together, so the bars and the chip
// cannot disagree.
import { cellKey, type CacheColumn } from "@/lib/boards/cache";
import { diffDaysISO } from "@/lib/boards/calendar";
import {
  boardWorkRule,
  dueISO,
  isStatusValueComplete,
  type BoardWorkSettings,
} from "@/lib/boards/overdue";

export type TimelineLate = {
  /** itemId → whole days since its due date. Late items only. */
  lateDays: Map<string, number>;
  /** The chip's completeness rule, for the group summary's done share. */
  isDone: (itemId: string) => boolean;
};

export function buildTimelineLate(input: {
  items: readonly { id: string }[];
  columns: readonly CacheColumn[];
  cellMap: ReadonlyMap<string, unknown>;
  todayISO: string;
  /** The board's Work tracking settings (`cache.board`); omitted = guess. */
  board?: Partial<BoardWorkSettings> | null;
}): TimelineLate {
  const rule = boardWorkRule(input.columns, input.board);
  const statusColumn = rule.statusColumn;
  const isDone = (itemId: string) =>
    isStatusValueComplete(
      statusColumn
        ? (input.cellMap.get(cellKey(itemId, statusColumn.id)) ?? null)
        : null,
      rule,
    );
  const lateDays = new Map<string, number>();
  const dueColumn = rule.dueColumn;
  if (!dueColumn) return { lateDays, isDone };
  for (const it of input.items) {
    if (isDone(it.id)) continue;
    const due = dueISO(input.cellMap.get(cellKey(it.id, dueColumn.id)));
    if (due === null || due >= input.todayISO) continue;
    const days = diffDaysISO(due, input.todayISO);
    lateDays.set(it.id, Number.isFinite(days) && days > 0 ? days : 1);
  }
  return { lateDays, isDone };
}
