// Pure render-time done / overdue predicates for a board already in memory
// (0 extra round-trips, gotcha-09). They hold NO rule of their own: which
// status column, which options mean done and which ONE date column is the due
// date all come from the board's Work tracking rule (`resolveWorkRule` in
// ./work-guess, the TypeScript twin of public.item_facts). So the date tint,
// the done burst, group progress, the timeline's "late", Board Intelligence
// and reports agree with Today, My Work and the folder pages.
//
// overdue ⇔ the item is open AND its due date (the rule's due column, `end`
// when the cell is a range) is strictly before today. A date column that is
// not the due column never tints.
import type {
  CacheBoard,
  CacheCellValue,
  CacheColumn,
} from "@/lib/boards/cache";
import {
  dueDateOf,
  isDoneOption,
  resolveWorkRule,
  type WorkRule,
  type WorkTrackingSettings,
} from "@/lib/boards/work-guess";

/**
 * "Today" for every client-side display surface (tint, timeline, signals): the
 * VIEWER's wall-clock date as `YYYY-MM-DD`, not UTC. Server-computed numbers
 * (folders, health, digest, Today) use the member's / organisation's zone
 * instead; see decision-46.
 */
export function localTodayISO(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

type RuleColumn = Pick<
  CacheColumn,
  "id" | "kind" | "position" | "name" | "settings"
>;

/** A board's resolved Work tracking rule over its cached columns. */
export type BoardWorkRule<T extends RuleColumn = CacheColumn> = WorkRule<T>;

/** The board fields the rule reads; pass `cache.board` / `payload.board`. */
export type BoardWorkSettings = Pick<CacheBoard, keyof WorkTrackingSettings>;

/**
 * The board's Work tracking rule. Resolve it ONCE per render (a `useMemo`
 * over `columns` and the board) and thread it down; never per cell. Without
 * `board` (callers that hold only columns) every choice is the guess.
 */
export function boardWorkRule<T extends RuleColumn>(
  columns: readonly T[],
  board?: Partial<BoardWorkSettings> | null,
): BoardWorkRule<T> {
  return resolveWorkRule(columns, board);
}

/**
 * Complete ⇔ `value` (the item's cell in the rule's status column) holds a
 * done option: a configured done option, or, with none configured, one whose
 * label looks done ("Done", "Completed", "Cancelled"; not "Incomplete").
 * O(1): callers pass the cell they already hold.
 */
export function isStatusValueComplete(
  value: unknown,
  rule: Pick<
    WorkRule<Pick<CacheColumn, "settings">>,
    "statusColumn" | "doneOptionIds"
  > | null,
): boolean {
  if (!rule?.statusColumn) return false;
  const optionId =
    typeof value === "object" && value !== null
      ? (value as { optionId?: string | null }).optionId
      : null;
  if (!optionId) return false;
  const options =
    (
      rule.statusColumn.settings as {
        options?: { id: string; label: string }[];
      }
    )?.options ?? [];
  const option = Array.isArray(options)
    ? options.find((o) => o.id === optionId)
    : undefined;
  return isDoneOption(rule, optionId, option?.label ?? null);
}

/**
 * Complete ⇔ the item's cell in the rule's status column holds a done option.
 * O(all cell values): for callers that hold only a raw board payload; render
 * hot paths use {@link boardWorkRule} + {@link isStatusValueComplete}.
 */
export function isItemComplete(
  itemId: string,
  columns: readonly RuleColumn[],
  cellValues: readonly CacheCellValue[],
  board?: Partial<BoardWorkSettings> | null,
): boolean {
  const rule = boardWorkRule(columns, board);
  if (!rule.statusColumn) return false;
  const statusId = rule.statusColumn.id;
  const cell = cellValues.find(
    (v) => v.item_id === itemId && v.column_id === statusId,
  );
  return isStatusValueComplete(cell?.value ?? null, rule);
}

/**
 * The due date a date cell carries (`end`, else `date`), or null when it is
 * missing or not a real calendar date. The one place that reads a cell's due
 * date.
 */
export function dueISO(value: unknown): string | null {
  return dueDateOf(value);
}

/**
 * Whether a date cell's value is strictly before `todayISO`. This is only the
 * date half of overdue: the caller must also check that the cell belongs to
 * the rule's due column ({@link isDueColumn}) and that the item is open.
 */
export function isOverdue(value: unknown, todayISO: string): boolean {
  const due = dueISO(value);
  return due !== null && due < todayISO;
}

/** Whether `columnId` is the rule's due column: the only one that may tint. */
export function isDueColumn(
  rule: Pick<WorkRule<Pick<CacheColumn, "id">>, "dueColumn"> | null,
  columnId: string,
): boolean {
  return rule?.dueColumn?.id === columnId;
}
