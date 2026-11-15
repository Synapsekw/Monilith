// Work tracking guesses: which status options mean done, which column is the
// status, which column is the due date, when a board owner has not set Work
// tracking explicitly. The source of truth at read time is the
// `public.item_facts` view (Today, My Work, query_items, get_focus_today);
// this module is its TypeScript twin, used by the Work tracking dialog to show
// what the view will pick. `work-guess.test.ts` pins both sides together: the
// latest item_facts migration must contain the exact expressions built from
// WORK_GUESS_SQL, and the shared parity table must match the outcomes
// `scripts/sql/verify-item-facts.sql` asserts.
//
// Word boundaries: any non-letter (start/end, space, underscore, digit,
// punctuation) separates words, so "due_date" and "Due2" read as due-like
// while "Calendar", "Weekend", "Backend", "Pending" and "Vendor" do not.
// Letters are Postgres `[:alpha:]` / JS `\p{L}`.
//
// Known limits (accepted, both sides agree):
//  * "Cancellation requested", "Pending cancel", "Uncancelled" read as done
//    (anything containing cancel);
//  * "Not yet done", "Cannot complete" read as done (the negation must sit
//    right before done/complete);
//  * "Done in complete form" reads as open (contains "in complete");
//  * exotic code points: JS `iu` folds the Kelvin sign (U+212A) to k, Postgres
//    `~*` does not.
//
// ONE RULE (2026-11-15, vault/decisions decision-46): every surface reads done,
// the due date and overdue through this rule. In SQL: item_facts, and through
// it Today, My Work, query_items, the health widget, the weekly digest and
// every folder RPC (_work_item_flags). In TypeScript: `resolveWorkRule` below,
// used by the board's overdue tint, done burst, group progress, timeline
// "late", Board Intelligence signals and reports (via @/lib/boards/overdue).
// Goals, portfolios, the dashboard completion widget and automations keep the
// done mapping the user stored per link; only their DEFAULT suggestion calls
// `looksDoneLabel`.

const NOT_LETTER_BEFORE = "(^|[^[:alpha:]])";
const NOT_LETTER_AFTER = "([^[:alpha:]]|$)";
const word = (alternatives: string) =>
  `${NOT_LETTER_BEFORE}(${alternatives})${NOT_LETTER_AFTER}`;

/** The Postgres patterns the view uses, all applied with `~*` (case-insensitive). */
export const WORK_GUESS_SQL = {
  /** Date column names that look like a due date. */
  dueName: word("due|deadline|end|finish|target"),
  /** Date column names that look like a start date (ranked last). */
  startName: word("start|begin|kickoff|created"),
  /** Date column names that look like a baseline, not the live due date. */
  baselineName: word("original|baseline|planned|initial|previous|old"),
  /** Status labels that mean finished: Done, Completed, Cancelled, Canceled. */
  doneLabel: "(done|complete|cancel)",
  /** Negated forms that are NOT finished: Incomplete, In complete, Not done, Undone, Uncompleted. */
  notDoneLabel: String.raw`${NOT_LETTER_BEFORE}(not[\s-]*|un[\s-]*|in[\s-]*)(done|complete)`,
} as const;

// JavaScript equivalents of the patterns above.
const jsWord = (alternatives: string) =>
  new RegExp(`(?<!\\p{L})(${alternatives})(?!\\p{L})`, "iu");

const DUE_NAME = jsWord("due|deadline|end|finish|target");
const START_NAME = jsWord("start|begin|kickoff|created");
const BASELINE_NAME = jsWord("original|baseline|planned|initial|previous|old");
const DONE_LABEL = /(done|complete|cancel)/iu;
const NOT_DONE_LABEL =
  /(?<!\p{L})(not[\s-]*|un[\s-]*|in[\s-]*)(done|complete)/iu;

/**
 * A status label means done when it says done / complete / cancel(l)ed and is
 * not a negated form of done or complete ("Incomplete", "Not done", "Undone").
 */
export function looksDoneLabel(label: string | null | undefined): boolean {
  if (!label) return false;
  return DONE_LABEL.test(label) && !NOT_DONE_LABEL.test(label);
}

/**
 * The option to SET when work completes (automation recipes): the first one
 * that looks done and is not a cancellation, else the first that looks done.
 * "Cancelled" counts as done when READING a board, but it is not what
 * "Completed sets 100%" should write.
 */
export function guessCompletedOption<T extends { label: string }>(
  options: readonly T[],
): T | undefined {
  const done = options.filter((o) => looksDoneLabel(o.label));
  return done.find((o) => !/cancel/iu.test(o.label)) ?? done[0];
}

export function looksDueName(name: string): boolean {
  return DUE_NAME.test(name);
}

export function looksStartName(name: string): boolean {
  return START_NAME.test(name);
}

export function looksBaselineName(name: string): boolean {
  return BASELINE_NAME.test(name);
}

type GuessColumn = {
  id: string;
  name: string;
  kind: string;
  position: number;
};

function byPositionThenId(a: GuessColumn, b: GuessColumn): number {
  if (a.position !== b.position) return a.position - b.position;
  // uuid order in Postgres equals lowercase-hex string order.
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** The board's status column under the guess: lowest position, then id. */
export function guessStatusColumn<T extends GuessColumn>(
  columns: readonly T[],
): T | undefined {
  return columns.filter((c) => c.kind === "status").sort(byPositionThenId)[0];
}

/**
 * The board's due-date column under the guess. Sort keys, in order (the same
 * three keys as the view's ORDER BY):
 *  1. due-like and not baseline-like first ("Due", "End date", "due_date");
 *  2. start-like last ("Start", "Kickoff");
 *  3. baseline-like after the rest ("Original due", "Planned finish");
 *  4. position, then id.
 * Resulting tiers: live due names, then neutral names, then baseline names,
 * then start names. A board with only "Start" or only "Original due" still
 * gets that column.
 */
export function guessDueColumn<T extends GuessColumn>(
  columns: readonly T[],
): T | undefined {
  const keys = (c: GuessColumn) => [
    looksDueName(c.name) && !looksBaselineName(c.name) ? 0 : 1,
    looksStartName(c.name) ? 1 : 0,
    looksBaselineName(c.name) ? 1 : 0,
  ];
  return columns
    .filter((c) => c.kind === "date")
    .sort((a, b) => {
      const ka = keys(a);
      const kb = keys(b);
      for (let i = 0; i < ka.length; i++) {
        if (ka[i] !== kb[i]) return ka[i] - kb[i];
      }
      return byPositionThenId(a, b);
    })[0];
}

/** A board's Work tracking settings (`boards.work_*`); all null = guess. */
export type WorkTrackingSettings = {
  work_status_column_id: string | null;
  work_done_option_ids: string[] | null;
  work_due_column_id: string | null;
};

/**
 * The rule a board's items are read with: which status column, which of its
 * options mean done, and which ONE date column is the due date.
 */
export type WorkRule<T> = {
  /** The column completeness is read from, or null (nothing is ever done). */
  statusColumn: T | null;
  /** Configured done option ids; null = guess from the option's label. */
  doneOptionIds: readonly string[] | null;
  /** The one column that holds the due date, or null (nothing is ever overdue). */
  dueColumn: T | null;
};

/**
 * Twin of the three choices `public.item_facts` makes per board:
 *  * status column: the configured one (when it is still a status column on
 *    this board; a stale id gives NO column, never a silent fallback), else
 *    the guess;
 *  * done options: the configured ids, which apply only while a status column
 *    is configured too, else the label guess;
 *  * due column: the configured one (same stale rule), else the guess.
 */
export function resolveWorkRule<T extends GuessColumn>(
  columns: readonly T[],
  settings?: Partial<WorkTrackingSettings> | null,
): WorkRule<T> {
  const statusId = settings?.work_status_column_id ?? null;
  const dueId = settings?.work_due_column_id ?? null;
  const doneIds = settings?.work_done_option_ids ?? null;
  return {
    statusColumn:
      statusId === null
        ? (guessStatusColumn(columns) ?? null)
        : (columns.find((c) => c.id === statusId && c.kind === "status") ??
          null),
    doneOptionIds: statusId !== null && doneIds !== null ? doneIds : null,
    dueColumn:
      dueId === null
        ? (guessDueColumn(columns) ?? null)
        : (columns.find((c) => c.id === dueId && c.kind === "date") ?? null),
  };
}

/**
 * Whether a status option means done under `rule`: one of the configured ids,
 * or, without configured ids, a label that looks done. `label` is the label
 * of the option the cell holds in the rule's status column (null when the
 * cell is empty or names an option that no longer exists).
 */
export function isDoneOption(
  rule: Pick<WorkRule<unknown>, "doneOptionIds">,
  optionId: string | null | undefined,
  label: string | null | undefined,
): boolean {
  if (!optionId) return false;
  if (rule.doneOptionIds !== null) return rule.doneOptionIds.includes(optionId);
  return looksDoneLabel(label);
}

/**
 * The due date a date cell carries, as `YYYY-MM-DD`, or null. Twin of the
 * view's `due_date`: `end` when it is a non-empty string, else `date`; the
 * first ten characters must be a real calendar date ("2026-02-31" and "TBD"
 * are null).
 */
export function dueDateOf(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const { date, end } = value as { date?: unknown; end?: unknown };
  const raw = typeof end === "string" && end !== "" ? end : date;
  if (typeof raw !== "string") return null;
  const iso = raw.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const t = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== iso)
    return null;
  return iso;
}

/** Overdue: open, with a due date strictly before `todayISO`. */
export function isOverdueOn(
  due: string | null,
  done: boolean,
  todayISO: string,
): boolean {
  return !done && due !== null && due < todayISO;
}
