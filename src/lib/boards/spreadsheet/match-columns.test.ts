import { describe, it, expect } from "vitest";
import {
  isKindCompatible,
  autoMatchColumns,
  missingOptionLabels,
  type BoardColumnRef,
} from "./match-columns";

describe("isKindCompatible", () => {
  it("is true when source === target", () => {
    expect(isKindCompatible("numbers", "numbers")).toBe(true);
    expect(isKindCompatible("date", "date")).toBe(true);
  });
  it("is true when target is text, regardless of source", () => {
    expect(isKindCompatible("numbers", "text")).toBe(true);
    expect(isKindCompatible("dropdown", "text")).toBe(true);
    expect(isKindCompatible("checkbox", "text")).toBe(true);
  });
  it("is false for mismatched non-text kinds", () => {
    expect(isKindCompatible("numbers", "date")).toBe(false);
    expect(isKindCompatible("text", "numbers")).toBe(false);
    expect(isKindCompatible("dropdown", "status")).toBe(false);
  });
});

describe("autoMatchColumns", () => {
  const boardColumns: BoardColumnRef[] = [
    { id: "col-1", name: "Status", kind: "status", options: [] },
    { id: "col-2", name: "Due Date", kind: "date", options: [] },
    { id: "col-3", name: "Notes", kind: "text", options: [] },
    { id: "col-4", name: "Resume", kind: "files", options: [] },
  ];

  it("matches an exact name with a compatible kind", () => {
    const headers = [{ name: "Status", kind: "status" as const }];
    expect(autoMatchColumns(headers, boardColumns)).toEqual(["col-1"]);
  });

  it("normalizes names (trim, lowercase, collapse whitespace) before matching", () => {
    const headers = [{ name: "  due   date ", kind: "date" as const }];
    expect(autoMatchColumns(headers, boardColumns)).toEqual(["col-2"]);
  });

  it("returns null when the name matches but the kind is incompatible", () => {
    const headers = [{ name: "Status", kind: "numbers" as const }];
    expect(autoMatchColumns(headers, boardColumns)).toEqual([null]);
  });

  it("returns null when no board column shares the normalized name", () => {
    const headers = [{ name: "Owner", kind: "text" as const }];
    expect(autoMatchColumns(headers, boardColumns)).toEqual([null]);
  });

  it("lets the first of two same-named headers claim the board column, the second gets null", () => {
    const headers = [
      { name: "Resume", kind: "text" as const },
      { name: "Resume", kind: "text" as const },
    ];
    const withTextResume: BoardColumnRef[] = [
      ...boardColumns,
      { id: "col-5", name: "Resume", kind: "text", options: [] },
    ];
    expect(autoMatchColumns(headers, withTextResume)).toEqual(["col-5", null]);
  });

  it("matches anything against a text target", () => {
    const headers = [{ name: "Notes", kind: "checkbox" as const }];
    expect(autoMatchColumns(headers, boardColumns)).toEqual(["col-3"]);
  });

  it("processes headers independently otherwise, in order", () => {
    const headers = [
      { name: "Due Date", kind: "date" as const },
      { name: "Status", kind: "status" as const },
      { name: "Unknown", kind: "text" as const },
    ];
    expect(autoMatchColumns(headers, boardColumns)).toEqual([
      "col-2",
      "col-1",
      null,
    ]);
  });
});

describe("missingOptionLabels", () => {
  const target: BoardColumnRef = {
    id: "col-1",
    name: "Tags",
    kind: "dropdown",
    options: [
      { id: "o1", label: "Urgent", color: "red" },
      { id: "o2", label: "Backlog", color: "gray" },
    ],
  };

  it("splits comma-separated dropdown values and returns distinct missing labels", () => {
    const result = missingOptionLabels(
      ["Urgent, New Feature", "Backlog", "New Feature"],
      "dropdown",
      target,
    );
    expect(result).toEqual(["New Feature"]);
  });

  it("compares case-insensitively but returns the original casing of the missing label", () => {
    const result = missingOptionLabels(
      ["URGENT", "backlog"],
      "dropdown",
      target,
    );
    expect(result).toEqual([]);
  });

  it("returns [] when kind is not dropdown/status-like and nothing is missing", () => {
    const result = missingOptionLabels(["Urgent"], "dropdown", target);
    expect(result).toEqual([]);
  });

  it("trims whitespace around comma-split values", () => {
    const result = missingOptionLabels(
      [" Urgent ,  New One  "],
      "dropdown",
      target,
    );
    expect(result).toEqual(["New One"]);
  });

  it("ignores empty values from trailing commas or blank cells", () => {
    const result = missingOptionLabels(
      ["Urgent,", "", "  "],
      "dropdown",
      target,
    );
    expect(result).toEqual([]);
  });
});
