import { z } from "zod";
import type { ChangelogEntry } from "./types";

// Field separators shared with the generator's `git log --format` string
// (Task 4 derives the git `%x..` escapes from these). Control characters that
// never appear in commit text keep parsing unambiguous.
export const RECORD_SEP = "\x00"; // between commits
export const FIELD_SEP = "\x1f"; // between a commit's date and its trailer block
export const VALUE_SEP = "\x1e"; // between multiple Changelog trailers in one commit

const kindSchema = z.enum(["new", "improved", "fixed"]);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * Parse `git log` output (in the generator's fixed --format) into changelog
 * entries. Pure: no git, no I/O. Malformed trailers/dates are skipped with a
 * warning so a historical typo can never wedge the build.
 */
export function parseChangelogTrailers(gitLog: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];

  for (const record of gitLog.split(RECORD_SEP)) {
    if (!record.trim()) continue;

    const [rawDate = "", rawTrailers = ""] = record.split(FIELD_SEP);
    if (!rawTrailers.trim()) continue; // commit has no Changelog trailer

    const date = rawDate.trim();
    if (!dateSchema.safeParse(date).success) {
      console.warn(`changelog: skipping commit with bad date "${date}"`);
      continue;
    }

    for (const raw of rawTrailers.split(VALUE_SEP)) {
      const value = raw.trim();
      if (!value) continue;

      const [rawKind = "", title = "", description = ""] = value
        .split("|")
        .map((p) => p.trim());

      const kind = kindSchema.safeParse(rawKind);
      if (!kind.success || !title) {
        console.warn(`changelog: skipping malformed trailer "${value}"`);
        continue;
      }

      entries.push({
        date,
        kind: kind.data,
        title,
        ...(description ? { description } : {}),
      });
    }
  }

  return entries;
}
