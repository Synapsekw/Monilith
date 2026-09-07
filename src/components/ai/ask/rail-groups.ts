import type { ConversationRow } from "@/lib/ai/ask/conversations";

/** Same local calendar day as `now`. Local, not UTC: the rail says "Today" to a
 *  person, and a person's day is the one their clock is on. */
function isSameLocalDay(iso: string, now: Date): boolean {
  const d = new Date(iso);
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

/** Today / Earlier, preserving the server's newest-first order. Pure, so the
 *  rail can regroup on every keystroke without a round-trip. */
export function groupChats(
  rows: readonly ConversationRow[],
  now: Date,
): { today: ConversationRow[]; earlier: ConversationRow[] } {
  const today: ConversationRow[] = [];
  const earlier: ConversationRow[] = [];
  for (const r of rows) {
    (isSameLocalDay(r.updated_at, now) ? today : earlier).push(r);
  }
  return { today, earlier };
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
