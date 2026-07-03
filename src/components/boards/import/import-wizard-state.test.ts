import { describe, expect, it } from "vitest";
import {
  deriveSheetState,
  tableFor,
  invalidCellMap,
  buildCommitColumns,
  summarize,
} from "./import-wizard-state";

const grid = [
  ["Group", "Name", "Est"],
  ["Build", "Task A", "5"],
  ["Build", "↳ Sub", "oops"], // "oops" is invalid for numbers
  ["QA", "Task B", "3"],
];

describe("deriveSheetState", () => {
  it("derives roles, kinds and includes for every column", () => {
    const s = deriveSheetState(grid, 0);
    expect(s.columns.map((c) => c.role)).toEqual(["group", "name", "data"]);
    expect(s.columns[2].kind).toBe("numbers");
    expect(s.columns.every((c) => c.include)).toBe(true);
  });

  it("throws the selectRows empty passthrough for a blank sheet", () => {
    expect(() => deriveSheetState([[]], 0)).toThrow("empty");
  });
});

describe("invalidCellMap + summarize", () => {
  it("flags unparseable cells by grid row index and counts them", () => {
    const s = deriveSheetState(grid, 0);
    const t = tableFor(grid, s);
    const invalid = invalidCellMap(t, s.columns);
    expect([...invalid.entries()]).toEqual([[2, [2]]]);
    expect(summarize(t, s)).toEqual({
      items: 2,
      subitems: 1,
      columns: 1,
      invalid: 1,
    });
  });
});

describe("buildCommitColumns", () => {
  it("drops excluded columns and strips options for non-option kinds", () => {
    const s = deriveSheetState(grid, 0);
    s.columns[0].include = false;
    const specs = buildCommitColumns(s);
    expect(specs.map((c) => c.sourceIndex)).toEqual([1, 2]);
    expect(specs.every((c) => c.options.length === 0)).toBe(true);
  });
});
