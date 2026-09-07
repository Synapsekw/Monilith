import { describe, expect, it } from "vitest";
import { filterRows, groupChats } from "./rail-groups";

/** Fixed reference instant, built from LOCAL parts so the expectations hold in
 *  every timezone the suite runs in (a UTC literal put the 09:00Z row on the
 *  previous local day east of UTC+10). */
const NOW = new Date(2026, 8, 7, 15, 0, 0); // 2026-09-07, 15:00 local

/** A row `n` local days before NOW, at midday so no expectation sits on a
 *  day boundary. */
function rowDaysAgo(id: string, n: number, title = `Chat ${id}`) {
  const d = new Date(2026, 8, 7 - n, 12, 0, 0);
  return { id, title, updated_at: d.toISOString() };
}

describe("groupChats", () => {
  it("buckets by age: today, last week, two weeks ago, older", () => {
    const groups = groupChats(
      [
        rowDaysAgo("today", 0),
        rowDaysAgo("yesterday", 1),
        rowDaysAgo("weekEdge", 7),
        rowDaysAgo("eightDays", 8),
        rowDaysAgo("twoWeekEdge", 14),
        rowDaysAgo("ancient", 40),
      ],
      NOW,
    );

    expect(groups.map((g) => [g.key, g.rows.map((r) => r.id)])).toEqual([
      ["today", ["today"]],
      ["last-week", ["yesterday", "weekEdge"]],
      ["two-weeks", ["eightDays", "twoWeekEdge"]],
      ["older", ["ancient"]],
    ]);
  });

  it("labels each bucket for the rail", () => {
    const groups = groupChats([rowDaysAgo("a", 0), rowDaysAgo("b", 10)], NOW);
    expect(groups.map((g) => g.label)).toEqual(["Today", "Two weeks ago"]);
  });

  it("drops empty buckets rather than returning them empty", () => {
    const groups = groupChats([rowDaysAgo("a", 40)], NOW);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.key).toBe("older");
  });

  it("keeps the server's newest-first order inside a bucket", () => {
    const groups = groupChats(
      [rowDaysAgo("newer", 2), rowDaysAgo("older", 5)],
      NOW,
    );
    expect(groups[0]!.rows.map((r) => r.id)).toEqual(["newer", "older"]);
  });

  it("counts whole days, not elapsed hours: last night is not today", () => {
    // 23:50 "yesterday" is under 16 hours before NOW, but it is a different
    // local day — it must not land in Today.
    const lastNight = {
      id: "lastNight",
      title: "Late",
      updated_at: new Date(2026, 8, 6, 23, 50, 0).toISOString(),
    };
    const groups = groupChats([lastNight], NOW);
    expect(groups[0]!.key).toBe("last-week");
  });

  it("puts a future-dated row (clock skew) at the top, not in Older", () => {
    const groups = groupChats([rowDaysAgo("skewed", -1)], NOW);
    expect(groups[0]!.key).toBe("today");
  });

  it("returns nothing for no rows", () => {
    expect(groupChats([], NOW)).toEqual([]);
  });
});

describe("filterRows", () => {
  it("matches titles case-insensitively", () => {
    const rows = [
      rowDaysAgo("c1", 0, "Q3 slippage"),
      rowDaysAgo("c2", 0, "Hiring"),
    ];
    expect(filterRows(rows, "SLIP").map((r) => r.id)).toEqual(["c1"]);
  });

  it("returns everything for an empty query", () => {
    const rows = [rowDaysAgo("c1", 0, "A")];
    expect(filterRows(rows, "  ")).toEqual(rows);
  });
});
