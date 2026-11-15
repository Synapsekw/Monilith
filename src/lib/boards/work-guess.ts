// Work tracking guesses: which status options mean done, which column is the
// status, which column is the due date, when a board owner has not set Work
// tracking explicitly. The source of truth at read time is the
// `public.item_facts` view (Today, My Work, query_items, get_focus_today);
// this module is its TypeScript twin, used by the Work tracking dialog to show
// what the view will pick. `work-guess.test.ts` pins both sides together:
// WORK_GUESS_SQL must appear verbatim in the latest item_facts migration, and
// its parity cases are the ones `scripts/sql/verify-item-facts.sql` asserts.
//
// Other surfaces (overdue tint, board intelligence, goals, dashboards, health
// flags) still use the older /done|complete/i rule; they are not unified yet.

/**
 * The Postgres patterns the view uses, all applied with `~*` (case-
 * insensitive). `\m` / `\M` are Postgres word-start / word-end anchors.
 */
export const WORK_GUESS_SQL = {
  /** Date column names that look like a due date. */
  dueName: String.raw`\m(due|deadline|end|finish|target)\M`,
  /** Date column names that look like a start date (ranked last). */
  startName: String.raw`\m(start|begin|kickoff|created)\M`,
  /** Status labels that mean finished: Done, Completed, Cancelled, Canceled. */
  doneLabel: "(done|complete|cancel)",
  /** Negated forms that are NOT finished: Incomplete, Not done, Undone, Uncompleted. */
  notDoneLabel: String.raw`\m(not[\s-]*|un[\s-]*|in-?)(done|complete)`,
} as const;

// JavaScript equivalents. Postgres word characters are letters, digits and
// underscore (locale-aware), so the word anchors are written as Unicode
// lookarounds rather than the ASCII-only `\b`.
const W = String.raw`[\p{L}\p{N}_]`;
const wordStart = `(?<!${W})(?=${W})`;
const wordEnd = `(?<=${W})(?!${W})`;

const DUE_NAME = new RegExp(
  `${wordStart}(due|deadline|end|finish|target)${wordEnd}`,
  "iu",
);
const START_NAME = new RegExp(
  `${wordStart}(start|begin|kickoff|created)${wordEnd}`,
  "iu",
);
const DONE_LABEL = /(done|complete|cancel)/iu;
const NOT_DONE_LABEL = new RegExp(
  String.raw`${wordStart}(not[\s-]*|un[\s-]*|in-?)(done|complete)`,
  "iu",
);

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
 * The board's due-date column under the guess: a due-like name first, then
 * names that do not look like a start date, then position, then id. A board
 * whose only date column is "Start" still gets it.
 */
export function guessDueColumn<T extends GuessColumn>(
  columns: readonly T[],
): T | undefined {
  const rank = (c: GuessColumn) =>
    (looksDueName(c.name) ? 0 : 2) + (looksStartName(c.name) ? 1 : 0);
  return columns
    .filter((c) => c.kind === "date")
    .sort((a, b) => rank(a) - rank(b) || byPositionThenId(a, b))[0];
}
