export type ChangelogKind = "new" | "improved" | "fixed";

export interface ChangelogEntry {
  /** ISO date, "YYYY-MM-DD". */
  date: string;
  kind: ChangelogKind;
  /** Short, user-facing headline. */
  title: string;
  /** Optional one-line detail. */
  description?: string;
}
