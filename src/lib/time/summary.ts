import type { TimeAllocationFlat } from "./queries";

export type SummaryGroupBy = "item" | "category" | "day";

export type SummaryBucket = {
  key: string;
  label: string;
  totalSecs: number;
};

export type AllocationSummary = {
  buckets: SummaryBucket[];
  /**
   * Seconds from rows the grouping could not place — time logged against a
   * category when grouping by item, or against an item when grouping by
   * category. Always 0 for `day`, which excludes nothing.
   */
  ungroupedSecs: number;
};

/**
 * Pure fold over flat allocation rows. No client, no clock — the caller has
 * already bounded the window, so this is trivially unit-testable.
 *
 * A row only participates in the grouping whose dimension it carries: an
 * allocation is keyed by EITHER item_id OR category (the two unique partial
 * indexes on time_allocations), never both. So `groupBy: "item"` drops 100% of
 * category-logged time and vice versa — which is why the excluded seconds are
 * RETURNED rather than silently discarded. Buckets summing to less than the
 * window's real total, presented as the total, is the same "confidently partial
 * answer" the row-cap guard in get_time_summary already refuses to give.
 */
export function summarizeAllocations(
  rows: TimeAllocationFlat[],
  groupBy: SummaryGroupBy,
): AllocationSummary {
  const acc = new Map<string, SummaryBucket>();
  let ungroupedSecs = 0;

  for (const r of rows) {
    let key: string;
    let label: string;
    if (groupBy === "item") {
      if (!r.itemId) {
        ungroupedSecs += r.secs;
        continue;
      }
      key = r.itemId;
      label = r.itemName ?? r.itemId;
    } else if (groupBy === "category") {
      if (!r.category) {
        ungroupedSecs += r.secs;
        continue;
      }
      key = r.category;
      label = r.category;
    } else {
      key = r.date;
      label = r.date;
    }

    const existing = acc.get(key);
    if (existing) existing.totalSecs += r.secs;
    else acc.set(key, { key, label, totalSecs: r.secs });
  }

  return {
    buckets: [...acc.values()].sort((a, b) =>
      groupBy === "day"
        ? a.key.localeCompare(b.key)
        : b.totalSecs - a.totalSecs || a.label.localeCompare(b.label),
    ),
    ungroupedSecs,
  };
}
