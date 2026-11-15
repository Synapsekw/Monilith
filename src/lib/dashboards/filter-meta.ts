import type { FilterOperator } from "@/lib/validations/dashboards";

const EMPTIES: FilterOperator[] = ["is_empty", "not_empty"];

/** Operators offered for a column kind (lean tier — see D3b spec §2). */
export function operatorsForKind(kind: string): FilterOperator[] {
  switch (kind) {
    case "status":
      return ["is", "is_not", ...EMPTIES];
    case "text":
      return ["contains", "eq", ...EMPTIES];
    case "numbers":
    case "currency":
      return ["num_eq", "num_ne", "gt", "lt", ...EMPTIES];
    case "date":
      return ["before", "after", "on", ...EMPTIES];
    // dropdown/people value-matching is deferred; empties still work.
    case "time_tracking":
      return [];
    default:
      return [...EMPTIES];
  }
}

/**
 * Operators for the BOARD filter, which is evaluated in memory against the
 * loaded board (`board-filter.ts`) — where a relation cell is its linked item
 * names as text, so it can be text-matched.
 *
 * Deliberately separate from {@link operatorsForKind}: the dashboard-widget and
 * automation builders are evaluated in SQL over `cell_values`
 * (`dashboard_list_rows` / the automations predicate), where a relation column
 * has no row at all — `contains` / `eq` there would silently match nothing.
 */
export function boardOperatorsForKind(kind: string): FilterOperator[] {
  if (kind === "relation") return ["contains", "eq", ...EMPTIES];
  return operatorsForKind(kind);
}

export type ValueControl = "none" | "option" | "number" | "date" | "text";

/** Which value input a (kind, operator) pair needs. */
export function valueControlFor(
  kind: string,
  op: FilterOperator,
): ValueControl {
  if (op === "is_empty" || op === "not_empty") return "none";
  if (kind === "status") return "option";
  if (kind === "numbers" || kind === "currency") return "number";
  if (kind === "date") return "date";
  return "text";
}

export const OPERATOR_LABEL: Record<FilterOperator, string> = {
  is: "is",
  is_not: "is not",
  contains: "contains",
  eq: "equals",
  num_eq: "=",
  num_ne: "≠",
  gt: ">",
  lt: "<",
  before: "before",
  after: "after",
  on: "on",
  is_empty: "is empty",
  not_empty: "is not empty",
};
