/**
 * Pure due-date bucketing for the "My Work" page. No server/db imports so it is
 * trivially unit-testable and can run on either side of the boundary.
 *
 * A "My Work" row is an item the current user is assigned to (via a people
 * cell), enriched with its board, group, status and due date. The page groups
 * these by how soon they are due — the most actionable default for "what do I
 * need to do".
 */

/** The one status token pair carried through from the item's status cell. */
export type MyWorkStatus = {
  label: string;
  /** Raw CSS color stored on the status option (hex) — rendered as a pill. */
  color: string;
};

export type MyWorkItem = {
  itemId: string;
  itemName: string;
  boardId: string;
  boardName: string;
  groupName: string | null;
  status: MyWorkStatus | null;
  /** Canonical `YYYY-MM-DD`, or null when the item has no date cell. */
  dueDate: string | null;
};

export type DueBucket = "overdue" | "today" | "week" | "later" | "none";

export type MyWorkGroup = {
  bucket: DueBucket;
  label: string;
  items: MyWorkItem[];
};

const BUCKET_LABEL: Record<DueBucket, string> = {
  overdue: "Overdue",
  today: "Today",
  week: "This week",
  later: "Later",
  none: "No date",
};

/** Render order of the buckets (empty ones are omitted by {@link bucketMyWork}). */
const BUCKET_ORDER: readonly DueBucket[] = [
  "overdue",
  "today",
  "week",
  "later",
  "none",
] as const;

const DAY = 86_400_000;

function isoToUTC(iso: string): number {
  return Date.parse(`${iso}T00:00:00Z`);
}

/**
 * The ISO date (`YYYY-MM-DD`) of the last day of the week containing `todayIso`.
 * `weekStartsOn` matches the repo convention (1 = Monday, as in workload), so
 * the week ends on Sunday by default.
 */
export function endOfWeek(todayIso: string, weekStartsOn = 1): string {
  const t = isoToUTC(todayIso);
  const dow = new Date(t).getUTCDay(); // 0 = Sun … 6 = Sat
  const sinceStart = (dow - weekStartsOn + 7) % 7;
  const endOffset = 6 - sinceStart;
  return new Date(t + endOffset * DAY).toISOString().slice(0, 10);
}

/**
 * Classify a single due date. ISO date strings (`YYYY-MM-DD`) sort
 * lexicographically the same as chronologically, so plain string comparison is
 * correct and avoids any timezone drift.
 */
export function bucketFor(
  dueDate: string | null,
  todayIso: string,
  weekEndIso: string,
): DueBucket {
  if (!dueDate) return "none";
  if (dueDate < todayIso) return "overdue";
  if (dueDate === todayIso) return "today";
  if (dueDate <= weekEndIso) return "week";
  return "later";
}

/**
 * Group assigned items by due-date bucket. Dated buckets are sorted by due date
 * ascending then name; the undated bucket is sorted by name. Empty buckets are
 * dropped, and the remaining buckets are returned in {@link BUCKET_ORDER}.
 */
export function bucketMyWork(
  items: MyWorkItem[],
  todayIso: string,
  weekStartsOn = 1,
): MyWorkGroup[] {
  const weekEnd = endOfWeek(todayIso, weekStartsOn);
  const byBucket = new Map<DueBucket, MyWorkItem[]>();

  for (const item of items) {
    const bucket = bucketFor(item.dueDate, todayIso, weekEnd);
    const list = byBucket.get(bucket) ?? [];
    list.push(item);
    byBucket.set(bucket, list);
  }

  const groups: MyWorkGroup[] = [];
  for (const bucket of BUCKET_ORDER) {
    const list = byBucket.get(bucket);
    if (!list || list.length === 0) continue;
    list.sort((a, b) => {
      if (
        bucket !== "none" &&
        a.dueDate &&
        b.dueDate &&
        a.dueDate !== b.dueDate
      ) {
        return a.dueDate < b.dueDate ? -1 : 1;
      }
      return a.itemName.localeCompare(b.itemName);
    });
    groups.push({ bucket, label: BUCKET_LABEL[bucket], items: list });
  }
  return groups;
}
