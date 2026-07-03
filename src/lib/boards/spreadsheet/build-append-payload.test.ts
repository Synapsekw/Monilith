import { describe, it, expect } from "vitest";
import { buildAppendPayload } from "./build-append-payload";
import type { BoardColumnRef } from "./match-columns";
import type { ParsedTable, ColumnSpec } from "./types";

const table: ParsedTable = {
  header: ["Name", "Status", "Extra"],
  rows: [
    ["Task A", "Done", "10"],
    ["Task B", "New Label", "20"],
  ],
  rowIndices: [1, 2],
};

const baseSpecs: ColumnSpec[] = [
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

const boardColumns: BoardColumnRef[] = [
  {
    id: "col-status",
    name: "Status",
    kind: "status",
    options: [{ id: "opt-done", label: "Done", color: "#00c875" }],
  },
];

describe("buildAppendPayload", () => {
  it("encodes a mapped status column with the TARGET's existing option id, not a new one", () => {
    const payload = buildAppendPayload(table, baseSpecs, boardColumns, {
      groupId: "g-1",
    });

    const itemA = payload.items.find((i) => i.name === "Task A");
    expect(itemA).toBeDefined();
    const statusCellA = itemA!.cells.find((c) => c.columnId === "col-status");
    expect(statusCellA).toBeDefined();
    expect(statusCellA!.value).toEqual({ optionId: "opt-done" });
  });

  it("mints a fresh SynthOption via optionAdditions for a label missing from the target", () => {
    const payload = buildAppendPayload(table, baseSpecs, boardColumns, {
      groupId: "g-1",
    });

    expect(payload.optionAdditions).toHaveLength(1);
    const addition = payload.optionAdditions[0];
    expect(addition.columnId).toBe("col-status");
    expect(addition.options).toHaveLength(1);
    expect(addition.options[0].label).toBe("New Label");
    expect(addition.options[0].id).not.toBe("opt-done");
    expect(addition.options[0].id).not.toBe("spec-new");
    // Color picked via nextOptionColor, distinct from the target's existing color
    expect(addition.options[0].color).not.toBe("#00c875");

    const itemB = payload.items.find((i) => i.name === "Task B");
    expect(itemB).toBeDefined();
    const statusCellB = itemB!.cells.find((c) => c.columnId === "col-status");
    expect(statusCellB).toBeDefined();
    expect(statusCellB!.value).toEqual({ optionId: addition.options[0].id });
  });

  it('mints a new column for target: "create" and encodes cells against it', () => {
    const payload = buildAppendPayload(table, baseSpecs, boardColumns, {
      groupId: "g-1",
    });

    expect(payload.newColumns).toHaveLength(1);
    const newCol = payload.newColumns[0];
    expect(newCol.kind).toBe("numbers");
    expect(newCol.name).toBe("Extra");

    const itemA = payload.items.find((i) => i.name === "Task A");
    const extraCellA = itemA!.cells.find((c) => c.columnId === newCol.id);
    expect(extraCellA).toBeDefined();
    expect(extraCellA!.value).toEqual({ n: 10 });

    const itemB = payload.items.find((i) => i.name === "Task B");
    const extraCellB = itemB!.cells.find((c) => c.columnId === newCol.id);
    expect(extraCellB!.value).toEqual({ n: 20 });
  });

  it("throws on an unknown target columnId", () => {
    const specs: ColumnSpec[] = [
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
      buildAppendPayload(table, specs, boardColumns, { groupId: "g-1" }),
    ).toThrow("unknown target column");
  });

  it("throws on a target whose board column kind is not importable (e.g. people)", () => {
    const peopleColumns: BoardColumnRef[] = [
      { id: "col-people", name: "Assignee", kind: "people", options: [] },
    ];
    const specs: ColumnSpec[] = [
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
      buildAppendPayload(table, specs, peopleColumns, { groupId: "g-1" }),
    ).toThrow("incompatible column kind");
  });

  it("throws without a name-role spec", () => {
    const specs = baseSpecs.filter((s) => s.role !== "name");
    expect(() =>
      buildAppendPayload(table, specs, boardColumns, { groupId: "g-1" }),
    ).toThrow("no name column");
  });

  it("builds a newGroup with a minted uuid when destination has a newGroupName", () => {
    const payload = buildAppendPayload(table, baseSpecs, boardColumns, {
      newGroupName: "Backlog",
    });

    expect(payload.groupId).toBeUndefined();
    expect(payload.newGroup).toBeDefined();
    expect(payload.newGroup!.name).toBe("Backlog");
    expect(typeof payload.newGroup!.id).toBe("string");
    expect(payload.newGroup!.id.length).toBeGreaterThan(0);
    expect(typeof payload.newGroup!.color).toBe("string");
  });

  it("attaches subitems (↳ prefix) to their parent item's id, in the single append group", () => {
    const subTable: ParsedTable = {
      header: ["Name", "Extra"],
      rows: [
        ["Task A", "1"],
        ["↳ Sub A1", "2"],
      ],
      rowIndices: [1, 2],
    };
    const specs: ColumnSpec[] = [
      { sourceIndex: 0, name: "Name", kind: "text", options: [], role: "name" },
      {
        sourceIndex: 1,
        name: "Extra",
        kind: "numbers",
        options: [],
        role: "data",
        target: "create",
      },
    ];

    const payload = buildAppendPayload(subTable, specs, [], { groupId: "g-1" });
    expect(payload.items).toHaveLength(1);
    expect(payload.subitems).toHaveLength(1);
    expect(payload.subitems[0].parentId).toBe(payload.items[0].id);
    expect(payload.subitems[0].name).toBe("Sub A1");
  });
});
