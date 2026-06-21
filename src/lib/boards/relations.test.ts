import { describe, it, expect } from "vitest";
import { sortLinks, relationRollup, type RelationLink } from "./relations";

const mk = (id: string, pos: number): RelationLink => ({
  id,
  itemId: "i1",
  columnId: "c1",
  linkedItemId: `t-${id}`,
  linkedItemName: id,
  position: pos,
});

describe("relations helpers", () => {
  it("sorts by position", () => {
    const out = sortLinks([mk("b", 2), mk("a", 0), mk("c", 1)]);
    expect(out.map((l) => l.id)).toEqual(["a", "c", "b"]);
  });
  it("rollup counts distinct linked items", () => {
    expect(relationRollup([])).toBe("");
    expect(relationRollup([mk("a", 0)])).toBe("1 linked");
    expect(relationRollup([mk("a", 0), mk("b", 1), mk("c", 2)])).toBe(
      "3 linked",
    );
  });
});
