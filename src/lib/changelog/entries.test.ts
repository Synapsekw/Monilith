import { describe, expect, it } from "vitest";
import { CHANGELOG, formatDate, groupByDate } from "./entries";
import type { ChangelogEntry } from "./types";

describe("groupByDate", () => {
  it("returns [] for no entries", () => {
    expect(groupByDate([])).toEqual([]);
  });

  it("sorts groups newest-first and groups same-date entries", () => {
    const entries: ChangelogEntry[] = [
      { date: "2026-06-01", kind: "fixed", title: "A" },
      { date: "2026-06-10", kind: "new", title: "B" },
      { date: "2026-06-10", kind: "improved", title: "C" },
    ];
    const groups = groupByDate(entries);
    expect(groups.map((g) => g.date)).toEqual(["2026-06-10", "2026-06-01"]);
    expect(groups[0].entries.map((e) => e.title)).toEqual(["B", "C"]);
    expect(groups[1].entries.map((e) => e.title)).toEqual(["A"]);
  });
});

describe("formatDate", () => {
  it("formats an ISO date as a long en-US date", () => {
    expect(formatDate("2026-06-18")).toBe("June 18, 2026");
  });
});

describe("CHANGELOG", () => {
  it("is non-empty and every entry is well-formed", () => {
    expect(CHANGELOG.length).toBeGreaterThan(0);
    for (const e of CHANGELOG) {
      expect(e.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(["new", "improved", "fixed"]).toContain(e.kind);
      expect(e.title.length).toBeGreaterThan(0);
    }
  });
});
