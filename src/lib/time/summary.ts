import type { TimeAllocationFlat } from "./queries";

export type SummaryGroupBy = "item" | "category" | "day";

export type SummaryBucket = {
  key: string;
  label: string;
  totalSecs: number;
};

/**
 * Pure fold over flat allocation rows. No client, no clock — the caller has
 * already bounded the window, so this is trivially unit-testable.
 *
 * A row only participates in the grouping whose dimension it carries: an
 * allocation is keyed by EITHER item_id OR category (the two unique partial
 * indexes on time_allocations), never both.
 */
export function summarizeAllocations(
  rows: TimeAllocationFlat[],
  groupBy: SummaryGroupBy,
): SummaryBucket[] {
  const acc = new Map<string, SummaryBucket>();

  for (const r of rows) {
    let key: string | null = null;
    let label = "";
    if (groupBy === "item") {
      if (!r.itemId) continue;
      key = r.itemId;
      label = r.itemName ?? r.itemId;
    } else if (groupBy === "category") {
      if (!r.category) continue;
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

  return [...acc.values()].sort((a, b) =>
    groupBy === "day"
      ? a.key.localeCompare(b.key)
      : b.totalSecs - a.totalSecs || a.label.localeCompare(b.label),
  );
}
