import type { ConversationRow } from "@/lib/ai/ask/conversations";

/** Midnight of the LOCAL day a timestamp falls in. Local, not UTC: the rail
 *  says "Today" to a person, and a person's day is the one their clock is on. */
function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Whole local days between `iso` and `now` — 0 is today, 1 is yesterday.
 *  Measured between day BOUNDARIES, so a chat at 23:50 last night is one day
 *  old at 00:10, not zero. */
function daysAgo(iso: string, now: Date): number {
  const ms =
    startOfLocalDay(now).getTime() - startOfLocalDay(new Date(iso)).getTime();
  return Math.round(ms / 86_400_000);
}

/** A rail section: a bucket of chats under one heading. `key` is stable across
 *  renders so the rail can remember which sections the owner opened. */
export type RailGroup = {
  key: "today" | "last-week" | "two-weeks" | "older";
  label: string;
  rows: ConversationRow[];
};

/**
 * The buckets, oldest boundary last. Ordered by their UPPER bound so the first
 * match wins; `older` has none and catches the tail.
 *
 * "Last week" is a rolling 7 days rather than a calendar week: the rail is
 * read as "how long ago did I ask this", and a Monday-boundary week puts
 * Sunday's chat and Monday's chat in different sections for no reason a person
 * would recognise.
 */
const BUCKETS: ReadonlyArray<{
  key: RailGroup["key"];
  label: string;
  maxDaysAgo: number;
}> = [
  { key: "today", label: "Today", maxDaysAgo: 0 },
  { key: "last-week", label: "Last week", maxDaysAgo: 7 },
  { key: "two-weeks", label: "Two weeks ago", maxDaysAgo: 14 },
  { key: "older", label: "Older", maxDaysAgo: Number.POSITIVE_INFINITY },
];

/**
 * Group chats into age buckets, preserving the server's newest-first order
 * inside each one.
 *
 * PURE, and empty buckets are dropped rather than returned empty: the rail
 * renders one collapsible section per group, and a section that says "(0)" is
 * a control that can only disappoint. Pure also means the rail can regroup on
 * every keystroke of the search box without a round-trip (working agreement #5).
 */
export function groupChats(
  rows: readonly ConversationRow[],
  now: Date,
): RailGroup[] {
  const byKey = new Map<RailGroup["key"], ConversationRow[]>();
  for (const r of rows) {
    const age = daysAgo(r.updated_at, now);
    // A row timestamped in the FUTURE (clock skew between the browser and the
    // database) reads as a negative age; it belongs at the top, not in "Older".
    const bucket = BUCKETS.find((b) => age <= b.maxDaysAgo) ?? BUCKETS[0]!;
    const list = byKey.get(bucket.key);
    if (list) list.push(r);
    else byKey.set(bucket.key, [r]);
  }
  return BUCKETS.filter((b) => byKey.has(b.key)).map((b) => ({
    key: b.key,
    label: b.label,
    rows: byKey.get(b.key)!,
  }));
}

/** Title search over rows the page ALREADY loaded — a keystroke costs zero
 *  server round-trips (working agreement #5). */
export function filterRows(
  rows: readonly ConversationRow[],
  query: string,
): ConversationRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...rows];
  return rows.filter((r) => r.title.toLowerCase().includes(q));
}
