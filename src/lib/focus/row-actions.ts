import { looksDoneLabel, type WorkRule } from "@/lib/boards/work-guess";

/**
 * Pure rules behind the Today row actions. No server or database imports, so
 * they are unit-testable and safe on either side of the boundary.
 */

/**
 * The status option "mark done" writes, under the board's work rule:
 *  * with configured done options (Work tracking): the first configured one
 *    that still exists on the column;
 *  * otherwise the first option whose label looks done (the same guess
 *    `public.item_facts` reads with).
 * In both cases an option that is not a cancellation wins: "Cancelled" counts
 * as done when READING a board, but it is not what finishing a task should
 * write. Options keep their column order. Undefined = the board has no way to
 * say done.
 */
export function pickDoneOption<T extends { id: string; label: string }>(
  options: readonly T[],
  rule: Pick<WorkRule<unknown>, "doneOptionIds">,
): T | undefined {
  const configured = rule.doneOptionIds;
  const done =
    configured !== null
      ? options.filter((o) => configured.includes(o.id))
      : options.filter((o) => looksDoneLabel(o.label));
  return done.find((o) => !/cancel/iu.test(o.label)) ?? done[0];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The date cell value that makes `due` the item's due date. The due date of a
 * cell is its `end` when it has one, else its `date` (the `item_facts` rule),
 * so a range keeps its start and moves its end. A due date before the start
 * cannot be a range: the cell becomes that single day.
 */
export function withDueDate(
  current: unknown,
  due: string,
): { date: string; end?: string } {
  const cur =
    typeof current === "object" && current !== null
      ? (current as { date?: unknown; end?: unknown })
      : {};
  const start =
    typeof cur.date === "string" && ISO_DATE.test(cur.date) ? cur.date : null;
  const isRange = typeof cur.end === "string" && cur.end !== "";
  if (isRange && start !== null && start < due)
    return { date: start, end: due };
  return { date: due };
}
