import { describe, expect, it } from "vitest";
import { bucketItems, withSubitems } from "./item-tree";
import type { CacheItem } from "./cache";

function item(id: string, parent: string | null, position: number): CacheItem {
  return {
    id,
    parent_id: parent,
    position,
    name: id,
    board_id: "b",
    group_id: "g",
    org_id: "o",
  } as never;
}

describe("bucketItems", () => {
  it("separates top-level from children and sorts each by position", () => {
    const { topLevel, childrenByParent } = bucketItems([
      item("a", null, 2),
      item("b", null, 1),
      item("a2", "a", 2),
      item("a1", "a", 1),
    ]);
    expect(topLevel.map((i) => i.id)).toEqual(["b", "a"]);
    expect(childrenByParent.get("a")!.map((i) => i.id)).toEqual(["a1", "a2"]);
  });

  it("returns an empty children map when there are no subitems", () => {
    const { childrenByParent } = bucketItems([item("a", null, 1)]);
    expect(childrenByParent.size).toBe(0);
  });
});

describe("withSubitems", () => {
  it("appends each parent's subitems depth-first, in child order", () => {
    const { childrenByParent } = bucketItems([
      item("a", null, 1),
      item("b", null, 2),
      item("a1", "a", 1),
      item("a2", "a", 2),
    ]);
    expect(withSubitems(["a", "b"], childrenByParent)).toEqual([
      "a",
      "a1",
      "a2",
      "b",
    ]);
  });

  it("returns the ids unchanged when there are no subitems", () => {
    expect(withSubitems(["a", "b"], new Map())).toEqual(["a", "b"]);
  });

  it("emits every id at most once even if a child is also passed in", () => {
    const children = new Map([["a", [{ id: "a1" }]]]);
    expect(withSubitems(["a", "a1"], children)).toEqual(["a", "a1"]);
  });

  it("is cycle-safe against a malformed parent chain", () => {
    // a -> a1 -> a (bad data); must terminate and emit each id once.
    const children = new Map([
      ["a", [{ id: "a1" }]],
      ["a1", [{ id: "a" }]],
    ]);
    expect(withSubitems(["a"], children)).toEqual(["a", "a1"]);
  });

  it("returns an empty array for empty input", () => {
    expect(withSubitems([], new Map())).toEqual([]);
  });
});
