import { describe, it, expect } from "vitest";
import { resolveStructuredRows } from "./build-import-payload";
import type { ParsedTable, ImportGroup, RowStructureEntry } from "./types";

const table = (rows: string[][], indices: number[]): ParsedTable => ({
  header: ["Name"],
  rows,
  rowIndices: indices,
});

const G: ImportGroup[] = [
  { key: "g1", name: "Group 1", existingGroupId: null },
  { key: "g2", name: "Group 2", existingGroupId: "board-grp-2" },
];

describe("resolveStructuredRows", () => {
  it("splits items/subitems and attaches subitems to the nearest item above in the same group", () => {
    const t = table([["A"], ["B"], ["C"], ["D"]], [1, 2, 3, 4]);
    const structure: RowStructureEntry[] = [
      { gridIndex: 1, groupKey: "g1", type: "item" },
      { gridIndex: 2, groupKey: "g1", type: "subitem" },
      { gridIndex: 3, groupKey: "g2", type: "item" },
      { gridIndex: 4, groupKey: "g2", type: "subitem" },
    ];
    const res = resolveStructuredRows(t, 0, G, structure);

    expect(res.items.map((i) => i.name)).toEqual(["A", "C"]);
    expect(res.subitems).toHaveLength(2);
    expect(res.subitems[0]).toMatchObject({
      parentIndex: 0,
      name: "B",
      groupKey: "g1",
    });
    expect(res.subitems[1]).toMatchObject({
      parentIndex: 1,
      name: "D",
      groupKey: "g2",
    });
    expect(res.groups.map((g) => g.key)).toEqual(["g1", "g2"]);
  });

  it("drops groups that end up with no items", () => {
    const t = table([["A"]], [1]);
    const structure: RowStructureEntry[] = [
      { gridIndex: 1, groupKey: "g1", type: "item" },
    ];
    const res = resolveStructuredRows(t, 0, G, structure);
    expect(res.groups.map((g) => g.key)).toEqual(["g1"]);
  });

  it("promotes an orphan subitem (no item above it in its group) to an item", () => {
    const t = table([["A"], ["B"]], [1, 2]);
    const structure: RowStructureEntry[] = [
      { gridIndex: 1, groupKey: "g1", type: "item" },
      { gridIndex: 2, groupKey: "g2", type: "subitem" }, // no item in g2
    ];
    const res = resolveStructuredRows(t, 0, G, structure);
    expect(res.items.map((i) => i.name)).toEqual(["A", "B"]);
    expect(res.subitems).toHaveLength(0);
  });

  it("falls back to the first group + item for rows with no structure entry", () => {
    const t = table([["A"]], [1]);
    const res = resolveStructuredRows(t, 0, G, []);
    expect(res.items).toEqual([
      { groupKey: "g1", name: "A", row: ["A"], position: 0 },
    ]);
  });
});
