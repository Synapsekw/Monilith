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

// Column-resolution coverage (targets, kind-compat, option additions) ported
// from the pre-Task-4 single-group tests to the current multi-group signature.
// Fixture: two rows in one existing group — a status column mapped onto an
// existing board column, plus a "create" numbers column.
const resTable: ParsedTable = {
  header: ["Name", "Status", "Extra"],
  rows: [
    ["Task A", "Done", "10"],
    ["Task B", "New Label", "20"],
  ],
  rowIndices: [1, 2],
};

const resSpecs: ColumnSpec[] = [
  { sourceIndex: 0, name: "Name", kind: "text", options: [], role: "name" },
  {
    sourceIndex: 1,
    name: "Status",
    kind: "status",
    options: [
      { id: "spec-done", label: "Done", color: "#e2445c" },
      { id: "spec-new", label: "New Label", color: "#579bfc" },
    ],
    role: "data",
    target: { columnId: "col-status" },
  },
  {
    sourceIndex: 2,
    name: "Extra",
    kind: "numbers",
    options: [],
    role: "data",
    target: "create",
  },
];

const resBoardColumns: BoardColumnRef[] = [
  {
    id: "col-status",
    name: "Status",
    kind: "status",
    options: [{ id: "opt-done", label: "Done", color: "#00c875" }],
  },
];

const resGroups: ImportGroup[] = [
  { key: "g1", name: "Backlog", existingGroupId: "board-grp-a" },
];
const resStructure: RowStructureEntry[] = [
  { gridIndex: 1, groupKey: "g1", type: "item" },
  { gridIndex: 2, groupKey: "g1", type: "item" },
];

describe("buildAppendPayload (column resolution)", () => {
  it("encodes a mapped target with the TARGET column's kind/options and mints no new column for it", () => {
    const p = buildAppendPayload(
      resTable,
      resSpecs,
      resBoardColumns,
      resGroups,
      resStructure,
    );

    const itemA = p.items.find((i) => i.name === "Task A")!;
    const statusCellA = itemA.cells.find((c) => c.columnId === "col-status")!;
    expect(statusCellA.value).toEqual({ optionId: "opt-done" });

    // The mapped target reuses the board column, so it is NOT in newColumns.
    expect(p.newColumns.map((c) => c.name)).toEqual(["Extra"]);
    expect(p.newColumns.find((c) => c.id === "col-status")).toBeUndefined();
  });

  it("mints an optionAdditions entry for a status label missing from the target board column", () => {
    const p = buildAppendPayload(
      resTable,
      resSpecs,
      resBoardColumns,
      resGroups,
      resStructure,
    );

    expect(p.optionAdditions).toHaveLength(1);
    const addition = p.optionAdditions[0];
    expect(addition.columnId).toBe("col-status");
    expect(addition.options).toHaveLength(1);
    expect(addition.options[0].label).toBe("New Label");
    expect(addition.options[0].id).not.toBe("opt-done");
    expect(addition.options[0].id).not.toBe("spec-new");
    // Color picked via nextOptionColor, distinct from the existing option's.
    expect(addition.options[0].color).not.toBe("#00c875");

    const itemB = p.items.find((i) => i.name === "Task B")!;
    const statusCellB = itemB.cells.find((c) => c.columnId === "col-status")!;
    expect(statusCellB.value).toEqual({ optionId: addition.options[0].id });
  });

  it("throws on an unknown target columnId", () => {
    const badSpecs: ColumnSpec[] = [
      { sourceIndex: 0, name: "Name", kind: "text", options: [], role: "name" },
      {
        sourceIndex: 1,
        name: "Status",
        kind: "status",
        options: [],
        role: "data",
        target: { columnId: "does-not-exist" },
      },
    ];
    expect(() =>
      buildAppendPayload(
        resTable,
        badSpecs,
        resBoardColumns,
        resGroups,
        resStructure,
      ),
    ).toThrow("unknown target column");
  });

  it("throws on a target whose board column kind is not importable (e.g. people)", () => {
    const peopleColumns: BoardColumnRef[] = [
      { id: "col-people", name: "Assignee", kind: "people", options: [] },
    ];
    const peopleSpecs: ColumnSpec[] = [
      { sourceIndex: 0, name: "Name", kind: "text", options: [], role: "name" },
      {
        sourceIndex: 1,
        name: "Assignee",
        kind: "text",
        options: [],
        role: "data",
        target: { columnId: "col-people" },
      },
    ];
    expect(() =>
      buildAppendPayload(
        resTable,
        peopleSpecs,
        peopleColumns,
        resGroups,
        resStructure,
      ),
    ).toThrow("incompatible column kind");
  });

  it("throws without a name-role spec", () => {
    const noNameSpecs = resSpecs.filter((s) => s.role !== "name");
    expect(() =>
      buildAppendPayload(
        resTable,
        noNameSpecs,
        resBoardColumns,
        resGroups,
        resStructure,
      ),
    ).toThrow("no name column");
  });
});

describe("buildAppendPayload — format scopes the CSV formula-guard undo", () => {
  const quotedTable: ParsedTable = {
    header: ["Name", "Notes"],
    rows: [["Alpha", "'- not a bullet, a typed apostrophe"]],
    rowIndices: [1],
  };
  const quotedStructure: RowStructureEntry[] = [
    { gridIndex: 1, groupKey: "g1", type: "item" },
  ];
  const oneGroup: ImportGroup[] = [
    { key: "g1", name: "Backlog", existingGroupId: null },
  ];

  it("xlsx keeps a leading apostrophe; csv (default) undoes the guard", () => {
    const csvPayload = buildAppendPayload(
      quotedTable,
      specs,
      boardColumns,
      oneGroup,
      quotedStructure,
      "csv",
    );
    const xlsxPayload = buildAppendPayload(
      quotedTable,
      specs,
      boardColumns,
      oneGroup,
      quotedStructure,
      "xlsx",
    );
    const csvCell = csvPayload.items[0].cells[0].value as { text: string };
    const xlsxCell = xlsxPayload.items[0].cells[0].value as { text: string };
    expect(csvCell.text).toBe("- not a bullet, a typed apostrophe");
    expect(xlsxCell.text).toBe("'- not a bullet, a typed apostrophe");
  });
});
