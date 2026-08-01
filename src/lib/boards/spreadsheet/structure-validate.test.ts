import { describe, it, expect } from "vitest";
import { findStructureValidationError } from "./structure-validate";
import type { ParsedTable, ImportGroup, RowStructureEntry } from "./types";

const group = (key: string): ImportGroup => ({
  key,
  name: `Group ${key}`,
  existingGroupId: null,
});

const groups: ImportGroup[] = [group("g1")];

/** A table whose only load-bearing field here is `rowIndices` — the guard walks
 * that list and never reads the cells — but header/rows are filled in so the
 * fixture is a real `ParsedTable`, not a cast. */
const table = (rowIndices: number[]): ParsedTable => ({
  header: ["Name"],
  rows: rowIndices.map((i) => [`Row ${i}`]),
  rowIndices,
});

const entry = (
  gridIndex: number,
  type: RowStructureEntry["type"],
  groupKey = "g1",
): RowStructureEntry => ({ gridIndex, type, groupKey });

describe("findStructureValidationError", () => {
  it("returns null when every subitem follows an item in its group", () => {
    const res = findStructureValidationError(table([0, 1]), groups, [
      entry(0, "item"),
      entry(1, "subitem"),
    ]);
    expect(res).toBeNull();
  });

  it("flags a subitem with no item above it, using 1-based row numbers", () => {
    const res = findStructureValidationError(table([0]), groups, [
      entry(0, "subitem"),
    ]);
    expect(res).toContain("1 subitem row(s)");
    expect(res).toContain("row 1");
  });

  it("scopes the parent check per group", () => {
    const res = findStructureValidationError(
      table([0, 1]),
      [group("g1"), group("g2")],
      [entry(0, "item", "g1"), entry(1, "subitem", "g2")],
    );
    expect(res).toContain("row 2");
  });

  it("truncates to five rows and reports the overflow count", () => {
    const idx = [0, 1, 2, 3, 4, 5, 6];
    const res = findStructureValidationError(
      table(idx),
      groups,
      idx.map((i) => entry(i, "subitem")),
    );
    expect(res).toContain("+2 more");
  });
});
