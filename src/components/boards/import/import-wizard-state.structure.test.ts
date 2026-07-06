import { describe, it, expect } from "vitest";
import {
  seedStructure,
  addGroup,
  bulkSetType,
  bulkSetGroup,
  orphanGridIndices,
  buildCommitColumns,
  buildCommitGroups,
  buildCommitStructure,
  deriveSheetState,
} from "./import-wizard-state";
import type { ParsedTable } from "@/lib/boards/spreadsheet/types";

// grid: header row 0, then 3 data rows
const grid = [["Name"], ["Alpha"], ["Beta"], ["Gamma"]];
const table: ParsedTable = {
  header: ["Name"],
  rows: [["Alpha"], ["Beta"], ["Gamma"]],
  rowIndices: [1, 2, 3],
};

function seededNew() {
  const base = deriveSheetState(grid, 0);
  return seedStructure(base, table, "new", []);
}

describe("import structure state", () => {
  it("seeds a flat start: one default group, all rows items", () => {
    const s = seededNew();
    expect(s.groups).toHaveLength(1);
    expect(s.groups[0].name).toBe("Imported");
    expect(s.groups[0].existingGroupId).toBeNull();
    const key = s.groups[0].key;
    for (const gi of [1, 2, 3]) {
      expect(s.structure[gi]).toEqual({ groupKey: key, type: "item" });
    }
  });

  it("existing mode seeds the board's first group as the default", () => {
    const base = deriveSheetState(grid, 0, []);
    const s = seedStructure(base, table, "existing", [
      { id: "grp-a", name: "Backlog" },
    ]);
    expect(s.groups[0]).toMatchObject({
      name: "Backlog",
      existingGroupId: "grp-a",
    });
  });

  it("addGroup appends a new editable group", () => {
    const s = addGroup(seededNew());
    expect(s.groups).toHaveLength(2);
    expect(s.groups[1].name).toBe("Group 2");
    expect(s.groups[1].existingGroupId).toBeNull();
  });

  it("bulkSetType and bulkSetGroup mutate the selected rows only", () => {
    let s = addGroup(seededNew());
    const g2 = s.groups[1].key;
    s = bulkSetGroup(s, [3], g2);
    s = bulkSetType(s, [2], "subitem");
    expect(s.structure[3].groupKey).toBe(g2);
    expect(s.structure[2].type).toBe("subitem");
    expect(s.structure[1].type).toBe("item");
  });

  it("orphanGridIndices flags a subitem with no item above it in its group", () => {
    let s = seededNew();
    // make row 1 (first row) a subitem => orphan in its group
    s = bulkSetType(s, [1], "subitem");
    expect(orphanGridIndices(table, s)).toEqual([1]);
  });

  it("buildCommitGroups drops groups with no items; buildCommitStructure emits one entry per row", () => {
    const s = addGroup(seededNew()); // Group 2 has no rows
    expect(buildCommitGroups(s).map((g) => g.name)).toEqual(["Imported"]);
    expect(buildCommitStructure(table, s)).toHaveLength(3);
  });

  it('never originates role:"group" for a "Group"-headed column (commit schema rejects it)', () => {
    // A "Group" header is exactly what the board export emits; proposeRoles
    // would flag it, but grouping is now owned by the Structure step, so
    // deriveSheetState must collapse to name/data only — otherwise the app's
    // own export→import round-trip fails at commit.
    const groupGrid = [
      ["Group", "Name", "Est"],
      ["Build", "Task A", "5"],
      ["QA", "Task B", "3"],
    ];
    const state = deriveSheetState(groupGrid, 0);

    expect(state.columns.some((c) => c.role === "group")).toBe(false);
    expect(buildCommitColumns(state).some((c) => c.role === "group")).toBe(
      false,
    );
  });
});
