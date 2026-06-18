import type { ChangelogEntry } from "./types";

export interface ChangelogGroup {
  date: string;
  entries: ChangelogEntry[];
}

/**
 * Hand-written, user-facing changelog. Newest entries can go anywhere —
 * `groupByDate` sorts. Add an entry when something noteworthy ships; keep the
 * wording for end users (no internal jargon, milestone codes, or file names).
 */
export const CHANGELOG: ChangelogEntry[] = [
  {
    date: "2026-06-18",
    kind: "new",
    title: "Board automations",
    description:
      "Set up rules that react to changes on your board — a guided builder with ready-made recipes.",
  },
  {
    date: "2026-06-10",
    kind: "improved",
    title: "Faster board loads",
    description: "Large boards open noticeably quicker.",
  },
  {
    date: "2026-06-02",
    kind: "new",
    title: "Command palette",
    description: "Press ⌘K to jump anywhere and run actions without the mouse.",
  },
];

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
