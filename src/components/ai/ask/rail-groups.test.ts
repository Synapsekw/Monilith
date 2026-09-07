import { describe, expect, it } from "vitest";
import { filterRows, groupChats } from "./rail-groups";

const row = (id: string, title: string, updated_at: string) => ({
  id,
  title,
  updated_at,
});
const NOW = new Date("2026-09-07T15:00:00Z");

describe("groupChats", () => {
  it("splits today from earlier in the viewer's local day", () => {
    const groups = groupChats(
      [
        row("c1", "Today thread", "2026-09-07T09:00:00Z"),
        row("c2", "Old thread", "2026-09-01T09:00:00Z"),
      ],
      NOW,
    );
    expect(groups.today.map((r) => r.id)).toEqual(["c1"]);
    expect(groups.earlier.map((r) => r.id)).toEqual(["c2"]);
  });

  it("keeps a section absent rather than empty", () => {
    const groups = groupChats([row("c2", "Old", "2026-09-01T09:00:00Z")], NOW);
    expect(groups.today).toEqual([]);
  });
});

describe("filterRows", () => {
  it("matches titles case-insensitively", () => {
    const rows = [row("c1", "Q3 slippage", "t"), row("c2", "Hiring", "t")];
    expect(filterRows(rows, "SLIP").map((r) => r.id)).toEqual(["c1"]);
  });

  it("returns everything for an empty query", () => {
    const rows = [row("c1", "A", "t")];
    expect(filterRows(rows, "  ")).toEqual(rows);
  });
});
