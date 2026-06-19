import type { ChangelogEntry } from "./types";
import { SEED } from "./seed";
import { GENERATED } from "./generated";

export interface ChangelogGroup {
  date: string;
  entries: ChangelogEntry[];
}

/**
 * The user-facing changelog: frozen pre-convention `SEED` plus everything
 * generated from `Changelog:` commit trailers. `groupByDate` sorts; entries may
 * appear in any order here.
 */
export const CHANGELOG: ChangelogEntry[] = [...SEED, ...GENERATED];

/** Group entries by date, newest date first, preserving authored order within a date. */
export function groupByDate(entries: ChangelogEntry[]): ChangelogGroup[] {
  const sorted = [...entries].sort((a, b) =>
    a.date < b.date ? 1 : a.date > b.date ? -1 : 0,
  );
  const groups: ChangelogGroup[] = [];
  for (const entry of sorted) {
    const last = groups[groups.length - 1];
    if (last && last.date === entry.date) {
      last.entries.push(entry);
    } else {
      groups.push({ date: entry.date, entries: [entry] });
    }
  }
  return groups;
}

/** Format an ISO "YYYY-MM-DD" as e.g. "June 18, 2026" (parsed in local time). */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
