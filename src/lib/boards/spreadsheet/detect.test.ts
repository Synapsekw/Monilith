import { describe, it, expect } from "vitest";
import { detectColumns, splitRows } from "./detect";
import { SUBTASK_MARKER } from "./types";

const header = ["Group", "Name", "Status", "Count"];
const rows = [
  ["Backlog", "Build login", "Working", "3"],
  ["Backlog", SUBTASK_MARKER + "Design form", "Done", "1"],
  ["Backlog", "Fix nav", "Done", "2"],
];

it("detects numbers and status columns", () => {
  const cols = detectColumns(header, rows);
  expect(cols.map((c) => c.header)).toEqual(["Status", "Count"]);
  expect(cols[1].kind).toBe("numbers");
  expect(cols[0].kind).toBe("status");
  expect(cols[0].options.length).toBe(2); // Working, Done
});

it("splits subtasks by marker and row order", () => {
  const s = splitRows(header, rows);
  expect(s.items.map((i) => i.name)).toEqual(["Build login", "Fix nav"]);
  expect(s.subitems).toEqual([
    { parentIndex: 0, name: "Design form", cells: ["Done", "1"] },
  ]);
  expect(s.groups).toEqual(["Backlog"]);
  expect(s.dataHeaders).toEqual(["Status", "Count"]);
});

it("falls back to one default group when no Group column", () => {
  const s = splitRows(["Name", "Status"], [["A", "Done"]]);
  expect(s.groups).toEqual(["Imported"]);
});

describe("detectColumns edge cases", () => {
  it("detects checkbox when all values are boolean-like", () => {
    const h = ["Name", "Active"];
    const r = [
      ["A", "true"],
      ["B", "false"],
      ["C", "yes"],
    ];
    const cols = detectColumns(h, r);
    expect(cols[0].kind).toBe("checkbox");
  });

  it("detects date when all values match ISO date pattern", () => {
    const h = ["Name", "Due"];
    const r = [
      ["A", "2024-01-15"],
      ["B", "2024-02-20"],
    ];
    const cols = detectColumns(h, r);
    expect(cols[0].kind).toBe("date");
  });

  it("falls back to text for mixed/unrecognized values", () => {
    const h = ["Name", "Notes"];
    const r = [
      ["A", "some note"],
      ["B", "another note with lots of text here"],
    ];
    const cols = detectColumns(h, r);
    expect(cols[0].kind).toBe("text");
  });

  it("synthesizes options with unique ids and colors for status columns", () => {
    const h = ["Name", "Priority"];
    const r = [
      ["A", "High"],
      ["B", "Low"],
      ["C", "High"],
    ];
    const cols = detectColumns(h, r);
    expect(cols[0].kind).toBe("status");
    expect(cols[0].options.length).toBe(2);
    const ids = cols[0].options.map((o) => o.id);
    expect(new Set(ids).size).toBe(2); // unique ids
    const colors = cols[0].options.map((o) => o.color);
    expect(colors[0]).not.toBe(colors[1]); // different colors
  });

  it("includes sampleValues in detected column", () => {
    const h = ["Name", "Score"];
    const r = [
      ["A", "10"],
      ["B", "20"],
    ];
    const cols = detectColumns(h, r);
    expect(cols[0].sampleValues).toContain("10");
    expect(cols[0].sampleValues).toContain("20");
  });
});

describe("splitRows edge cases", () => {
  it("falls back: first non-Group column is the name when no Name column", () => {
    // No "Name" column — first non-Group column ("Title") should be name
    const h = ["Group", "Title", "Status"];
    const r = [["Alpha", "My Task", "Done"]];
    const s = splitRows(h, r);
    expect(s.items[0].name).toBe("My Task");
    expect(s.dataHeaders).toEqual(["Status"]);
  });

  it("promotes subtask to top-level when no preceding parent in same group", () => {
    // First row is a subtask with no preceding top-level item
    const h = ["Name", "Status"];
    const r = [[SUBTASK_MARKER + "Orphan subtask", "Done"]];
    const s = splitRows(h, r);
    expect(s.items[0].name).toBe("Orphan subtask");
    expect(s.subitems).toHaveLength(0);
  });

  it("handles multiple groups correctly", () => {
    const h = ["Group", "Name", "Status"];
    const r = [
      ["Alpha", "Task A1", "Done"],
      ["Beta", "Task B1", "Working"],
      ["Alpha", "Task A2", "Done"],
      ["Beta", SUBTASK_MARKER + "Sub B1", "Done"],
    ];
    const s = splitRows(h, r);
    expect(s.groups).toEqual(["Alpha", "Beta"]); // first-seen order
    expect(s.items.map((i) => i.name)).toEqual([
      "Task A1",
      "Task B1",
      "Task A2",
    ]);
    expect(s.subitems.length).toBe(1);
    expect(s.subitems[0].name).toBe("Sub B1");
    // parentIndex should be index of "Task B1" in items array = 1
    expect(s.subitems[0].parentIndex).toBe(1);
  });

  it("assigns Imported group when no Group column and items have no group", () => {
    const h = ["Name", "Count"];
    const r = [
      ["X", "5"],
      [SUBTASK_MARKER + "Y", "2"],
    ];
    const s = splitRows(h, r);
    expect(s.groups).toEqual(["Imported"]);
    expect(s.items[0].group).toBe("Imported");
    expect(s.subitems[0].name).toBe("Y");
    expect(s.subitems[0].parentIndex).toBe(0);
  });
});
