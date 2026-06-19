import { describe, expect, it } from "vitest";

import type { ColumnOption } from "@/lib/validations/boards";

import {
  addOption,
  countOptionUsage,
  recolorOption,
  removeOption,
  renameOption,
  reorderOptions,
} from "./option-edit";

const base: ColumnOption[] = [
  { id: "a", label: "Alpha", color: "#00c875" },
  { id: "b", label: "Beta", color: "#fdab3d" },
];

describe("option-edit reducers", () => {
  it("addOption appends a 'New label' option", () => {
    const next = addOption(base);
    expect(next).toHaveLength(base.length + 1);
    expect(next[next.length - 1].label).toBe("New label");
    expect(base).toHaveLength(2); // original untouched
  });

  it("renameOption is immutable and renames by id", () => {
    const next = renameOption(base, "a", "Renamed");
    expect(next[0].label).toBe("Renamed");
    expect(base[0].label).toBe("Alpha");
  });

  it("recolorOption is immutable and recolors by id", () => {
    const next = recolorOption(base, "b", "#333333");
    expect(next[1].color).toBe("#333333");
    expect(base[1].color).toBe("#fdab3d");
  });

  it("reorderOptions(base, 0, 1) swaps order", () => {
    const next = reorderOptions(base, 0, 1);
    expect(next.map((o) => o.id)).toEqual(["b", "a"]);
  });

  it("removeOption drops the option by id", () => {
    const next = removeOption(base, "a");
    expect(next.map((o) => o.id)).toEqual(["b"]);
  });
});

describe("countOptionUsage", () => {
  it("counts status (optionId) and dropdown (optionIds) references on the column", () => {
    const cells = [
      { column_id: "col1", value: { optionId: "a" } },
      { column_id: "col1", value: { optionIds: ["a", "b"] } },
      { column_id: "col1", value: { optionId: "z" } }, // different option
      { column_id: "col2", value: { optionId: "a" } }, // different column
    ];
    expect(countOptionUsage(cells, "col1", "a")).toBe(2);
  });
});
