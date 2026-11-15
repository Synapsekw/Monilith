export type FocusTier = 1 | 2 | 3 | 4 | 5;

export type FocusWaiting = { name: string; assignees: string[] };

export type FocusFacts = {
  tier: FocusTier;
  daysOverdue: number | null;
  /** Days from today to the due date; set for tier 3 only. */
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
