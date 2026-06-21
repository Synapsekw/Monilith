import { describe, it, expect } from "vitest";
import {
  relationLinksForCell,
  setRelationLinksForCell,
  type BoardCache,
} from "./cache";
import type { RelationLink } from "./relations";

const link = (
  id: string,
  itemId: string,
  columnId: string,
  name: string | null,
): RelationLink => ({
  id,
  itemId,
  columnId,
  linkedItemId: `t-${id}`,
  linkedItemName: name,
  position: 0,
});

function cacheWith(relationLinks: RelationLink[]): BoardCache {
  return { relationLinks } as unknown as BoardCache;
}

describe("relation cache helpers", () => {
  it("relationLinksForCell filters to one cell's links", () => {
    const cache = cacheWith([
      link("1", "a", "x", "A1"),
      link("2", "a", "y", "A2"),
      link("3", "b", "x", "B1"),
    ]);
    expect(relationLinksForCell(cache, "a", "x").map((l) => l.id)).toEqual([
      "1",
    ]);
  });

  it("setRelationLinksForCell replaces only the target cell's links", () => {
    const cache = cacheWith([
      link("1", "a", "x", "A1"),
      link("2", "b", "x", "B1"),
    ]);
    const next = setRelationLinksForCell(cache, "a", "x", [
      link("9", "a", "x", "NEW"),
    ]);
    expect(relationLinksForCell(next, "a", "x").map((l) => l.id)).toEqual(["9"]);
    // other cells untouched
    expect(relationLinksForCell(next, "b", "x").map((l) => l.id)).toEqual(["2"]);
  });

  it("setRelationLinksForCell with [] clears a cell", () => {
    const cache = cacheWith([link("1", "a", "x", "A1")]);
    const next = setRelationLinksForCell(cache, "a", "x", []);
    expect(relationLinksForCell(next, "a", "x")).toEqual([]);
  });
});
