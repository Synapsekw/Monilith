import { describe, it, expect } from "vitest";
import { selectRows, columnLabel } from "./select-rows";

const grid = [
  ["junk", "", ""],
  ["Name", "Status", ""],
  ["Task A", "Done", ""],
  ["", "", ""],
  ["Task B", "Stuck", ""],
];

describe("columnLabel", () => {
  it("labels columns A..Z, AA..", () => {
    expect(columnLabel(0)).toBe("Column A");
    expect(columnLabel(25)).toBe("Column Z");
    expect(columnLabel(26)).toBe("Column AA");
  });
});

describe("selectRows", () => {
  it("uses the chosen header row and drops rows above it and empty rows", () => {
    const t = selectRows(grid, 1, []);
    expect(t.header).toEqual(["Name", "Status"]);
    expect(t.rows).toEqual([
      ["Task A", "Done"],
      ["Task B", "Stuck"],
    ]);
    expect(t.rowIndices).toEqual([2, 4]);
  });
  it("applies row exclusions by original grid index", () => {
    const t = selectRows(grid, 1, [2]);
    expect(t.rows).toEqual([["Task B", "Stuck"]]);
    expect(t.rowIndices).toEqual([4]);
  });
  it("synthesizes Column A/B headers when headerRow is null", () => {
    const t = selectRows(
      [
        ["a", "b"],
        ["c", "d", "e"],
      ],
      null,
      [],
    );
    expect(t.header).toEqual(["Column A", "Column B", "Column C"]);
    expect(t.rows).toEqual([
      ["a", "b", ""],
      ["c", "d", "e"],
    ]);
  });
  it("throws 'empty' for a blank header row and out-of-range header", () => {
    expect(() => selectRows(grid, 3, [])).toThrow("empty");
    expect(() => selectRows(grid, 99, [])).toThrow("empty");
    expect(() => selectRows([], null, [])).toThrow("empty");
  });
});
