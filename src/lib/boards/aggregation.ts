import type { AggregationId, ColumnKind } from "@/lib/validations/boards";

/**
 * The count family is presence-based and applies to every column kind. Order is
 * the UI order; `count` is the generic default for kinds with no richer summary.
 */
export const COUNT_FAMILY: readonly AggregationId[] = [
  "count",
  "count_filled",
  "count_empty",
  "count_unique",
];

/**
 * The aggregations a column of `kind` may show in the summary footer, in UI
 * order — the first entry is the sensible default. Pure; safe on client + server.
 *
 * A `mirror` column delegates to the kind of the column it mirrors (`targetKind`):
 * mirrored values are aggregated exactly as the target kind would be. When the
 * target is unknown (settings incomplete) or itself a mirror (no recursion), it
 * falls back to the universal count family.
 */
export function allowedAggregations(
  kind: ColumnKind,
  targetKind?: ColumnKind,
): AggregationId[] {
  switch (kind) {
    case "numbers":
      return ["sum", "avg", "min", "max", ...COUNT_FAMILY];
    case "rating":
      return ["avg", "min", "max", ...COUNT_FAMILY];
    case "status":
    case "dropdown":
      return ["distribution", ...COUNT_FAMILY];
    case "checkbox":
      return ["checked_total", "percent_checked", ...COUNT_FAMILY];
    case "date":
      return ["date_range", "earliest", "latest", ...COUNT_FAMILY];
    case "people":
      return ["count_unique", "count_filled", "count", "count_empty"];
    case "time_tracking":
      return ["total_tracked", "total_over_estimate", ...COUNT_FAMILY];
    case "files":
    case "relation":
      return ["count_filled", "count", "count_empty", "count_unique"];
    case "text":
    case "link":
    case "email":
    case "phone":
      return [...COUNT_FAMILY];
    case "mirror":
      if (!targetKind || targetKind === "mirror") return [...COUNT_FAMILY];
      return allowedAggregations(targetKind);
  }
}
