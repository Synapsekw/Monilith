/**
 * Why an item is on the Today list, in list order: 0 due today, 1 overdue,
 * 2 blocking someone, 3 due soon (tomorrow or the day after), 4 unread
 * replies, 5 stalled. Tier 0 exists only with `get_focus_today_v2`; the older
 * function reports an item due today as tier 3.
 */
export type FocusTier = 0 | 1 | 2 | 3 | 4 | 5;

/** Every tier, in the order the list shows them. */
export const FOCUS_TIERS: readonly FocusTier[] = [0, 1, 2, 3, 4, 5];

/**
 * Every item the list holds across tiers, or null when a tier is unknown.
 * Lives here (a pure module) so the client block can import it: the read in
 * `./queries` pulls in server-only code.
 */
export function focusTotal(
  totals: Record<FocusTier, number | null>,
): number | null {
  let sum = 0;
  for (const t of FOCUS_TIERS) {
    const n = totals[t];
    if (n === null) return null;
    sum += n;
  }
  return sum;
}

export type FocusWaiting = { name: string; assignees: string[] };

export type FocusFacts = {
  tier: FocusTier;
  daysOverdue: number | null;
  /** Days from today to the due date; set for tiers 0 and 3. */
  dueInDays?: number;
  waitingCount: number;
  /** At most two, already resolved to names. */
  waiting: FocusWaiting[];
  unreadCount: number;
  daysQuiet: number | null;
};

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

function waitingPhrase(f: FocusFacts): string | null {
  const first = f.waiting[0];
  if (!first || f.waitingCount === 0) return null;
  const owner = first.assignees[0];
  const lead = owner ? `${owner}'s "${first.name}"` : `"${first.name}"`;
  const more = f.waitingCount - 1;
  return more > 0
    ? `${lead} and ${more} more wait on this`
    : `${lead} waits on this`;
}

/** The one-line reason shown on a Today row and given to the assistant. */
export function focusReason(f: FocusFacts): string {
  const waiting = waitingPhrase(f);
  switch (f.tier) {
    case 0:
      return waiting ? `Due today · ${waiting}` : "Due today";
    case 1: {
      const head = plural(f.daysOverdue ?? 0, "day overdue", "days overdue");
      return waiting ? `${head} · ${waiting}` : head;
    }
    case 2:
      return waiting ?? "Someone is waiting on this";
    case 3:
      if (f.dueInDays === 0) return "Due today";
      if (f.dueInDays === 1) return "Due tomorrow";
      return `Due in ${f.dueInDays ?? 2} days`;
    case 4:
      return `${plural(f.unreadCount, "unread reply", "unread replies")} for you`;
    case 5:
      return `No activity for ${f.daysQuiet ?? 0} days`;
  }
}
