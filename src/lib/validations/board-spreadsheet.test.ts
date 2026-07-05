import { describe, it, expect } from "vitest";
import { commitImportSchema } from "./board-spreadsheet";

// Zod 4 enforces strict RFC 4122 UUID format (version + variant bits).
// "11111111-1111-1111-1111-111111111111" fails because the variant nibble
// must be [89abAB]. Use a valid UUIDv4-shaped string instead.
const base = {
  fileBase64: "eA==",
  fileName: "x.csv",
  sheetName: "Sheet1",
  headerRow: 0,
  excludedRows: [] as number[],
  columns: [
    { sourceIndex: 0, name: "Name", kind: "text", options: [], role: "name" },
  ],
  groups: [{ key: "g1", name: "Imported", existingGroupId: null }],
  structure: [{ gridIndex: 1, groupKey: "g1", type: "item" }],
  destination: {
    type: "new",
    workspaceId: "11111111-1111-4111-8111-111111111111",
    boardName: "B",
  },
};

describe("commitImportSchema", () => {
  it("accepts a valid new-board structured payload", () => {
    expect(commitImportSchema.safeParse(base).success).toBe(true);
  });

  it("rejects a structure row whose groupKey isn't in groups", () => {
    const bad = {
      ...base,
      structure: [{ gridIndex: 1, groupKey: "nope", type: "item" }],
    };
    expect(commitImportSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a 'group' role column", () => {
    const bad = {
      ...base,
      columns: [
        ...base.columns,
        {
          sourceIndex: 1,
          name: "Phase",
          kind: "text",
          options: [],
          role: "group",
        },
      ],
    };
    expect(commitImportSchema.safeParse(bad).success).toBe(false);
  });
});
