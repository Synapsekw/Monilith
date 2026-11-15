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
// Other surfaces (overdue tint, board intelligence, goals, dashboards, health
// flags) still use the older /done|complete/i rule; they are not unified yet.

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
