import { describe, it, expect } from "vitest";
import { buildImportPayload } from "./build-import-payload";
import type { ParsedSheet, ColumnMapping, SynthOption } from "./types";

// Shared option ids for the status column
const statusOption1: SynthOption = {
  id: "opt-todo",
  label: "Todo",
  color: "#00c875",
};
const statusOption2: SynthOption = {
  id: "opt-done",
  label: "Done",
  color: "#fdab3d",
};

const parsed: ParsedSheet = {
  header: ["Group", "Name", "Status", "Count"],
  rows: [
    ["Backlog", "Build login", "Todo", "5"],
    ["Backlog", "↳ Design form", "Done", "1"],
  ],
  droppedSheets: [],
};

const mappings: ColumnMapping[] = [
  { header: "Status", kind: "status", options: [statusOption1, statusOption2] },
  { header: "Count", kind: "numbers", options: [] },
];

describe("buildImportPayload", () => {
  it("produces 1 group, 2 columns, 1 top-level item, 1 subitem", () => {
    const result = buildImportPayload(parsed, mappings);
    const { templatePayload, subitems } = result;

    expect(templatePayload.groups).toHaveLength(1);
    expect(templatePayload.groups[0].name).toBe("Backlog");
    expect(templatePayload.groups[0].position).toBe(0);

    expect(templatePayload.columns).toHaveLength(2);
    expect(templatePayload.columns[0].kind).toBe("status");
    expect(templatePayload.columns[0].name).toBe("Status");
    expect(templatePayload.columns[0].position).toBe(0);
    expect(templatePayload.columns[1].kind).toBe("numbers");
    expect(templatePayload.columns[1].name).toBe("Count");
    expect(templatePayload.columns[1].position).toBe(1);

    expect(templatePayload.items).toHaveLength(1);
    const item = templatePayload.items[0];
    expect(item.name).toBe("Build login");
    expect(item.groupId).toBe(templatePayload.groups[0].id);
    expect(item.position).toBe(0);

    // Status cell: value.optionId must match the mapped option id for "Todo"
    const statusCell = item.cells.find(
      (c) => c.columnId === templatePayload.columns[0].id,
    );
    expect(statusCell).toBeDefined();
    expect((statusCell!.value as { optionId: string }).optionId).toBe(
      statusOption1.id,
    );

    // Count cell: value should be {n: 5}
    const countCell = item.cells.find(
      (c) => c.columnId === templatePayload.columns[1].id,
    );
    expect(countCell).toBeDefined();
    expect(countCell!.value).toEqual({ n: 5 });

    // Subitem
    expect(subitems).toHaveLength(1);
    const sub = subitems[0];
    expect(sub.name).toBe("Design form");
    expect(sub.parentId).toBe(item.id);
    expect(sub.groupId).toBe(templatePayload.groups[0].id);
    expect(sub.position).toBe(0);

    // Subitem count cell {n:1}
    const subCountCell = sub.cells.find(
      (c) => c.columnId === templatePayload.columns[1].id,
    );
    expect(subCountCell).toBeDefined();
    expect(subCountCell!.value).toEqual({ n: 1 });
  });

  it("status column settings contains the mapped options", () => {
    const result = buildImportPayload(parsed, mappings);
    const statusCol = result.templatePayload.columns[0];
    const settings = statusCol.settings as { options: SynthOption[] };
    expect(settings.options).toHaveLength(2);
    expect(settings.options[0].id).toBe(statusOption1.id);
    expect(settings.options[1].id).toBe(statusOption2.id);
  });

  it("columns with no options have empty settings object", () => {
    const result = buildImportPayload(parsed, mappings);
    const countCol = result.templatePayload.columns[1];
    expect(countCol.settings).toEqual({});
  });

  it("omits cells whose textToCell returns null", () => {
    // Use a sheet where Status is unparseable (no matching option)
    const parsedWithInvalid: ParsedSheet = {
      header: ["Group", "Name", "Status", "Count"],
      rows: [
        ["Alpha", "Task A", "UnknownStatus", "abc"], // "abc" is not a number → null for Count
      ],
      droppedSheets: [],
    };
    const result = buildImportPayload(parsedWithInvalid, mappings);
    const item = result.templatePayload.items[0];
    // "UnknownStatus" doesn't match any option → null → omitted
    const statusCell = item.cells.find(
      (c) => c.columnId === result.templatePayload.columns[0].id,
    );
    expect(statusCell).toBeUndefined();
    // "abc" is not a finite number → null → omitted
    const countCell = item.cells.find(
      (c) => c.columnId === result.templatePayload.columns[1].id,
    );
    expect(countCell).toBeUndefined();
    // No cells at all
    expect(item.cells).toHaveLength(0);
  });

  it("assigns unique uuids to each group, column, item, and subitem", () => {
    const result = buildImportPayload(parsed, mappings);
    const ids = [
      ...result.templatePayload.groups.map((g) => g.id),
      ...result.templatePayload.columns.map((c) => c.id),
      ...result.templatePayload.items.map((i) => i.id),
      ...result.subitems.map((s) => s.id),
    ];
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it("group color comes from GROUP_COLORS palette", () => {
    const GROUP_COLORS_FIRST = "#0073ea";
    const result = buildImportPayload(parsed, mappings);
    expect(result.templatePayload.groups[0].color).toBe(GROUP_COLORS_FIRST);
  });
});
