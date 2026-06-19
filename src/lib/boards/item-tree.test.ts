import { describe, expect, it } from "vitest";
import { bucketItems } from "./item-tree";
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
