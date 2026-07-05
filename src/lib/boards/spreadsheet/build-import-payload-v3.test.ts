import { describe, it, expect } from "vitest";
import { buildImportPayloadV3 } from "./build-import-payload";
import type {
  ParsedTable,
  ColumnSpec,
  ImportGroup,
  RowStructureEntry,
} from "./types";

const table: ParsedTable = {
  header: ["Name", "Notes"],
  rows: [
    ["Alpha", "a"],
    ["Beta", "b"],
    ["Gamma", "c"],
  ],
  rowIndices: [1, 2, 3],
};
const specs: ColumnSpec[] = [
  { sourceIndex: 0, name: "Name", kind: "text", options: [], role: "name" },
  { sourceIndex: 1, name: "Notes", kind: "text", options: [], role: "data" },
];
const groups: ImportGroup[] = [
  { key: "g1", name: "Group 1", existingGroupId: null },
  { key: "g2", name: "Group 2", existingGroupId: null },
];
const structure: RowStructureEntry[] = [
  { gridIndex: 1, groupKey: "g1", type: "item" },
  { gridIndex: 2, groupKey: "g1", type: "subitem" },
  { gridIndex: 3, groupKey: "g2", type: "item" },
];

describe("buildImportPayloadV3", () => {
  it("builds multiple groups, items placed in their group, subitem parented", () => {
    const p = buildImportPayloadV3(table, specs, groups, structure);
    expect(p.templatePayload.groups.map((g) => g.name)).toEqual([
      "Group 1",
      "Group 2",
    ]);
    // items: Alpha (g1), Gamma (g2)
    expect(p.templatePayload.items.map((i) => i.name)).toEqual([
      "Alpha",
      "Gamma",
    ]);
    const g1Id = p.templatePayload.groups[0].id;
    const g2Id = p.templatePayload.groups[1].id;
    expect(p.templatePayload.items[0].groupId).toBe(g1Id);
    expect(p.templatePayload.items[1].groupId).toBe(g2Id);
    // subitem Beta -> parent Alpha, in g1
    expect(p.subitems).toHaveLength(1);
    expect(p.subitems[0]).toMatchObject({
      name: "Beta",
      groupId: g1Id,
      parentId: p.templatePayload.items[0].id,
    });
  });

  it("only builds data columns, skipping 'skip' targets", () => {
    const p = buildImportPayloadV3(table, specs, groups, structure);
    expect(p.templatePayload.columns.map((c) => c.name)).toEqual(["Notes"]);
  });
});
