import { describe, it, expect } from "vitest";
import {
  colorForItem,
  TIMELINE_NEUTRAL_COLOR,
} from "@/lib/boards/timeline-color";
import type { CacheCellValue, CacheColumn } from "@/lib/boards/cache";

const statusCol = {
  id: "c1",
  kind: "status",
  settings: { options: [{ id: "o1", label: "Done", color: "#00c875" }] },
} as unknown as CacheColumn;

const dropdownCol = {
  id: "c2",
  kind: "dropdown",
  settings: { options: [{ id: "p1", label: "A", color: "#579bfc" }] },
} as unknown as CacheColumn;

const cells = [
  { item_id: "i1", column_id: "c1", value: { optionId: "o1" } },
  { item_id: "i2", column_id: "c1", value: { optionId: null } },
  { item_id: "i3", column_id: "c2", value: { optionIds: ["p1"] } },
] as unknown as CacheCellValue[];

describe("colorForItem", () => {
  it("returns null when no color column is selected", () => {
    expect(colorForItem("i1", null, cells)).toBeNull();
  });
  it("maps a status value to its option color", () => {
    expect(colorForItem("i1", statusCol, cells)).toBe("#00c875");
  });
  it("uses the first dropdown option color", () => {
    expect(colorForItem("i3", dropdownCol, cells)).toBe("#579bfc");
  });
  it("returns neutral when the item has no value in the column", () => {
    expect(colorForItem("i2", statusCol, cells)).toBe(TIMELINE_NEUTRAL_COLOR);
    expect(colorForItem("missing", statusCol, cells)).toBe(
      TIMELINE_NEUTRAL_COLOR,
    );
  });
});
