import { describe, expect, it } from "vitest";
import {
  IMPORT_MAPPING_JSON_SCHEMA,
  applyMappingSuggestions,
  type MappingSuggestion,
} from "@/lib/ai/import-mapping-schema";
import type {
  ColumnState,
  SheetState,
} from "@/components/boards/import/import-wizard-state";
import type { BoardColumnRef } from "@/lib/boards/spreadsheet/match-columns";

function col(overrides: Partial<ColumnState>): ColumnState {
  return {
    sourceIndex: 0,
    include: true,
    name: "Col",
    kind: "text",
    options: [],
    role: "data",
    detectedKind: "text",
    target: null,
    ...overrides,
  };
}

function sheet(columns: ColumnState[]): SheetState {
  return { headerRow: 0, excluded: [], columns, groups: [], structure: {} };
}

const boardColumns: BoardColumnRef[] = [
  { id: "col-status", name: "Status", kind: "status", options: [] },
  { id: "col-owner", name: "Owner", kind: "people", options: [] },
];

describe("IMPORT_MAPPING_JSON_SCHEMA", () => {
  it("is a JSON-schema object describing suggestions with kind/role enums", () => {
    const json = JSON.stringify(IMPORT_MAPPING_JSON_SCHEMA);
    // The kind enum must include every importable kind and the role enum both roles.
    expect(json).toContain("status");
    expect(json).toContain("dropdown");
    expect(json).toContain("name");
    expect(json).toContain("data");
    expect(json).toContain("sourceIndex");
    expect(json).toContain("targetColumnId");
  });
});

describe("applyMappingSuggestions", () => {
  it("patches kind/role/detectedKind for matched columns and returns a new state object", () => {
    const state = sheet([
      col({ sourceIndex: 0, name: "Title", kind: "text", role: "data" }),
      col({ sourceIndex: 1, name: "Stage", kind: "text", role: "data" }),
    ]);
    const suggestions: MappingSuggestion[] = [
      { sourceIndex: 0, kind: "text", role: "name" },
      { sourceIndex: 1, kind: "status", role: "data" },
    ];

    const next = applyMappingSuggestions(state, suggestions);

    expect(next).not.toBe(state);
    expect(next.columns).not.toBe(state.columns);
    const title = next.columns.find((c) => c.sourceIndex === 0)!;
    expect(title.role).toBe("name");
    const stage = next.columns.find((c) => c.sourceIndex === 1)!;
    expect(stage.role).toBe("data");
    expect(stage.kind).toBe("status");
    expect(stage.detectedKind).toBe("status");
  });

  it("resolves target to {columnId} when targetColumnId is a real board column, else 'create'", () => {
    const state = sheet([
      col({ sourceIndex: 0, name: "Stage", role: "data", target: "create" }),
      col({ sourceIndex: 1, name: "Extra", role: "data", target: "create" }),
    ]);
    const suggestions: MappingSuggestion[] = [
      {
        sourceIndex: 0,
        kind: "status",
        role: "data",
        targetColumnId: "col-status",
      },
      {
        sourceIndex: 1,
        kind: "text",
        role: "data",
        targetColumnId: "does-not-exist",
      },
    ];

    const next = applyMappingSuggestions(state, suggestions, boardColumns);

    expect(next.columns[0].target).toEqual({ columnId: "col-status" });
    expect(next.columns[1].target).toBe("create");
  });

  it("clamps an unknown kind by keeping the column's prior kind", () => {
    const state = sheet([
      col({ sourceIndex: 0, name: "Amount", kind: "numbers", role: "data" }),
    ]);
    const suggestions = [
      { sourceIndex: 0, kind: "bogus", role: "data" },
    ] as unknown as MappingSuggestion[];

    const next = applyMappingSuggestions(state, suggestions);

    expect(next.columns[0].kind).toBe("numbers");
  });

  it("clamps an invalid role to 'data'", () => {
    const state = sheet([
      col({ sourceIndex: 0, name: "Amount", kind: "numbers", role: "data" }),
    ]);
    const suggestions = [
      { sourceIndex: 0, kind: "numbers", role: "group" },
    ] as unknown as MappingSuggestion[];

    const next = applyMappingSuggestions(state, suggestions);

    expect(next.columns[0].role).toBe("data");
  });

  it("ignores a suggestion whose sourceIndex is out of range", () => {
    const state = sheet([
      col({ sourceIndex: 0, name: "Title", kind: "text", role: "data" }),
    ]);
    const suggestions: MappingSuggestion[] = [
      { sourceIndex: 99, kind: "status", role: "data" },
    ];

    const next = applyMappingSuggestions(state, suggestions);

    expect(next.columns[0].kind).toBe("text");
    expect(next.columns[0].role).toBe("data");
  });

  it("forces kind to 'text' and clears the target for a column promoted to the name role", () => {
    const state = sheet([
      col({
        sourceIndex: 0,
        name: "Label",
        kind: "status",
        role: "data",
        target: "create",
      }),
    ]);
    const suggestions: MappingSuggestion[] = [
      { sourceIndex: 0, kind: "status", role: "name" },
    ];

    const next = applyMappingSuggestions(state, suggestions, boardColumns);

    expect(next.columns[0].role).toBe("name");
    expect(next.columns[0].kind).toBe("text");
    // detectedKind preserves the suggested kind so a later demotion restores it.
    expect(next.columns[0].detectedKind).toBe("status");
    expect(next.columns[0].target).toBeNull();
  });

  it("leaves target untouched when no boardColumns are supplied (new-board mode)", () => {
    const state = sheet([
      col({ sourceIndex: 0, name: "Stage", role: "data", target: null }),
    ]);
    const suggestions: MappingSuggestion[] = [
      {
        sourceIndex: 0,
        kind: "status",
        role: "data",
        targetColumnId: "col-status",
      },
    ];

    const next = applyMappingSuggestions(state, suggestions);

    expect(next.columns[0].target).toBeNull();
  });
});
