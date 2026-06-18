import { describe, it, expect, vi } from "vitest";
import {
  parseChangelogTrailers,
  RECORD_SEP,
  FIELD_SEP,
  VALUE_SEP,
} from "@/lib/changelog/parse";

/** Build one git-log record in the exact --format the generator emits. */
function record(date: string, ...trailers: string[]): string {
  return `${date}${FIELD_SEP}${trailers.join(VALUE_SEP)}${RECORD_SEP}`;
}

describe("parseChangelogTrailers", () => {
  it("parses a single full trailer", () => {
    const log = record(
      "2026-06-18",
      "new | Board automations | Rules that react to changes.",
    );
    expect(parseChangelogTrailers(log)).toEqual([
      {
        date: "2026-06-18",
        kind: "new",
        title: "Board automations",
        description: "Rules that react to changes.",
      },
    ]);
  });

  it("omits description when absent", () => {
    const log = record("2026-06-18", "improved | Faster loads");
    expect(parseChangelogTrailers(log)).toEqual([
      { date: "2026-06-18", kind: "improved", title: "Faster loads" },
    ]);
  });

  it("supports multiple trailers in one commit", () => {
    const log = record("2026-06-18", "new | A", "fixed | B");
    expect(parseChangelogTrailers(log)).toEqual([
      { date: "2026-06-18", kind: "new", title: "A" },
      { date: "2026-06-18", kind: "fixed", title: "B" },
    ]);
  });

  it("skips commits with no Changelog trailer", () => {
    const log = record("2026-06-18") + record("2026-06-17", "new | Real");
    expect(parseChangelogTrailers(log)).toEqual([
      { date: "2026-06-17", kind: "new", title: "Real" },
    ]);
  });

  it("skips malformed trailers (bad kind / blank title) with a warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const log = record("2026-06-18", "bogus | X", "new |   ", "fixed | Good");
    expect(parseChangelogTrailers(log)).toEqual([
      { date: "2026-06-18", kind: "fixed", title: "Good" },
    ]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("skips records with a malformed date", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const log = record("not-a-date", "new | X");
    expect(parseChangelogTrailers(log)).toEqual([]);
    warn.mockRestore();
  });

  it("returns [] for empty input", () => {
    expect(parseChangelogTrailers("")).toEqual([]);
  });
});
