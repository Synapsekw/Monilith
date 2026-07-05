import { describe, it, expect } from "vitest";
import { findStructureValidationError } from "./spreadsheet-actions";
import type {
  ParsedTable,
  ImportGroup,
  RowStructureEntry,
} from "./spreadsheet/types";

const table: ParsedTable = {
  header: ["Name"],
  rows: [["A"], ["B"]],
  rowIndices: [1, 2],
};
const groups: ImportGroup[] = [
  { key: "g1", name: "G1", existingGroupId: null },
];

describe("findStructureValidationError", () => {
  it("returns null when every subitem has a parent above it", () => {
    const structure: RowStructureEntry[] = [
      { gridIndex: 1, groupKey: "g1", type: "item" },
      { gridIndex: 2, groupKey: "g1", type: "subitem" },
    ];
    expect(findStructureValidationError(table, groups, structure)).toBeNull();
  });

  it("returns a row-numbered error for an orphan subitem", () => {
    const structure: RowStructureEntry[] = [
      { gridIndex: 1, groupKey: "g1", type: "subitem" }, // orphan
      { gridIndex: 2, groupKey: "g1", type: "item" },
    ];
    const err = findStructureValidationError(table, groups, structure);
    expect(err).toMatch(/row 2/); // gridIndex 1 -> 1-based row 2
    expect(err).toMatch(/subitem/i);
  });
});
