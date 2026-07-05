import { describe, it, expect } from "vitest";
import { buildAppendPayload } from "./build-append-payload";
import type {
  ParsedTable,
  ColumnSpec,
  ImportGroup,
  RowStructureEntry,
} from "./types";
import type { BoardColumnRef } from "./match-columns";

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
  {
    sourceIndex: 1,
    name: "Notes",
    kind: "text",
    options: [],
    role: "data",
    target: "create",
  },
];
const boardColumns: BoardColumnRef[] = [];
const groups: ImportGroup[] = [
  { key: "g1", name: "Backlog", existingGroupId: "board-grp-a" }, // existing
  { key: "g2", name: "New Wave", existingGroupId: null }, // new
];
const structure: RowStructureEntry[] = [
  { gridIndex: 1, groupKey: "g1", type: "item" },
  { gridIndex: 2, groupKey: "g1", type: "subitem" },
  { gridIndex: 3, groupKey: "g2", type: "item" },
];

describe("buildAppendPayload (multi-group)", () => {
  it("emits existing + new groups and places items/subitems by groupId", () => {
    const p = buildAppendPayload(table, specs, boardColumns, groups, structure);

    const existing = p.groups.find((g) => g.existingGroupId === "board-grp-a")!;
    const created = p.groups.find((g) => g.existingGroupId === null)!;
    expect(existing.id).toBe("board-grp-a"); // reuse: id == existing group id
    expect(created.id).not.toBe("board-grp-a");

    expect(p.items.map((i) => i.name)).toEqual(["Alpha", "Gamma"]);
    expect(p.items[0].groupId).toBe("board-grp-a");
    expect(p.items[1].groupId).toBe(created.id);

    expect(p.subitems).toHaveLength(1);
    expect(p.subitems[0]).toMatchObject({
      name: "Beta",
      groupId: "board-grp-a",
      parentId: p.items[0].id,
    });

    expect(p.newColumns.map((c) => c.name)).toEqual(["Notes"]);
  });
});
