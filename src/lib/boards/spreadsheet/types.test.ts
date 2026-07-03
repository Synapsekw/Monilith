import { describe, it, expect } from "vitest";
import { SUBTASK_MARKER, IMPORTABLE_KINDS, MAX_COLS } from "./types";
import { PREVIEW_GRID_ROWS } from "./types";
import type {
  ColumnSpec,
  ImportDestination,
  ParsedTable,
  SheetPreview,
} from "./types";

describe("spreadsheet types", () => {
  it("exposes the subtask marker and caps", () => {
    expect(SUBTASK_MARKER).toBe("↳ ");
    expect(MAX_COLS).toBe(40);
  });
  it("lists 13 importable kinds without people/relation/mirror/files/time_tracking", () => {
    expect(IMPORTABLE_KINDS).toHaveLength(13);
    expect(IMPORTABLE_KINDS).toContain("currency");
    expect(IMPORTABLE_KINDS).toContain("priority");
    expect(IMPORTABLE_KINDS).not.toContain("people");
  });
});

describe("v2 types", () => {
  it("exposes the preview grid cap", () => {
    expect(PREVIEW_GRID_ROWS).toBe(200);
  });
  it("ColumnSpec/destination shapes compile", () => {
    const spec: ColumnSpec = {
      sourceIndex: 0,
      name: "Name",
      kind: IMPORTABLE_KINDS[0],
      options: [],
      role: "name",
    };
    const dest: ImportDestination = {
      type: "new",
      workspaceId: "w",
      boardName: "B",
    };
    const table: ParsedTable = {
      header: ["Name"],
      rows: [["a"]],
      rowIndices: [1],
    };
    const sheet: SheetPreview = {
      name: "S1",
      rowCount: 2,
      colCount: 1,
      grid: [["Name"], ["a"]],
    };
    expect([spec, dest, table, sheet]).toBeTruthy();
  });
});
