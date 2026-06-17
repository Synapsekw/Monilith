import { describe, expect, it } from "vitest";
import { formatCell, type DisplayColumn } from "./list-rows";

const status: DisplayColumn = {
  id: "c1",
  name: "Status",
  kind: "status",
  options: [{ id: "o1", label: "Done", color: "#00c875" }],
};
const text: DisplayColumn = {
  id: "c2",
  name: "Note",
  kind: "text",
  options: [],
};
const num: DisplayColumn = {
  id: "c3",
  name: "Pts",
  kind: "numbers",
  options: [],
};
const people: DisplayColumn = {
  id: "c4",
  name: "Who",
  kind: "people",
  options: [],
};
const date: DisplayColumn = {
  id: "c5",
  name: "Due",
  kind: "date",
  options: [],
};
const dropdown: DisplayColumn = {
  id: "c6",
  name: "Tags",
  kind: "dropdown",
  options: [
    { id: "d1", label: "Front", color: "#000" },
    { id: "d2", label: "Back", color: "#000" },
  ],
};

describe("formatCell", () => {
  it("status → label + color", () => {
    expect(formatCell(status, { optionId: "o1" })).toEqual({
      text: "Done",
      color: "#00c875",
    });
  });
  it("status with unknown/empty → dash, no color", () => {
    expect(formatCell(status, { optionId: null })).toEqual({ text: "—" });
    expect(formatCell(status, null)).toEqual({ text: "—" });
  });
  it("text → its string", () => {
    expect(formatCell(text, { text: "hi" })).toEqual({ text: "hi" });
    expect(formatCell(text, {})).toEqual({ text: "—" });
  });
  it("numbers → stringified n", () => {
    expect(formatCell(num, { n: 5 })).toEqual({ text: "5" });
  });
  it("people → assignee count", () => {
    expect(formatCell(people, { userIds: ["a", "b"] })).toEqual({ text: "2" });
    expect(formatCell(people, { userIds: [] })).toEqual({ text: "—" });
  });
  it("date → its string, empty → dash", () => {
    expect(formatCell(date, { date: "2026-06-17" })).toEqual({
      text: "2026-06-17",
    });
    expect(formatCell(date, { date: "" })).toEqual({ text: "—" });
    expect(formatCell(date, {})).toEqual({ text: "—" });
  });
  it("dropdown → joined known labels, skips unknown ids", () => {
    expect(
      formatCell(dropdown, { optionIds: ["d1", "missing", "d2"] }),
    ).toEqual({ text: "Front, Back" });
    expect(formatCell(dropdown, { optionIds: [] })).toEqual({ text: "—" });
  });
});
