import { describe, it, expect } from "vitest";
import { resolveDateColumn, itemDateRange } from "@/lib/boards/dates";

const cols = [
  { id: "c1", kind: "text" },
  { id: "d1", kind: "date" },
  { id: "d2", kind: "date" },
] as never;

describe("resolveDateColumn", () => {
  it("returns the configured date column when valid", () => {
    expect(resolveDateColumn(cols, { date_column_id: "d2" })?.id).toBe("d2");
  });
  it("falls back to the first date column", () => {
    expect(resolveDateColumn(cols, { date_column_id: "c1" })?.id).toBe("d1");
    expect(resolveDateColumn(cols, {})?.id).toBe("d1");
  });
  it("returns null when there is no date column", () => {
    expect(
      resolveDateColumn([{ id: "c1", kind: "text" }] as never, {}),
    ).toBeNull();
  });
});

describe("itemDateRange", () => {
  const cells = [
    {
      item_id: "i1",
      column_id: "d1",
      value: { date: "2026-06-10", end: "2026-06-12" },
    },
    { item_id: "i2", column_id: "d1", value: { date: "2026-06-15" } },
  ] as never;
  it("returns start+end for a range", () => {
    expect(itemDateRange("i1", cells, "d1")).toEqual({
      start: "2026-06-10",
      end: "2026-06-12",
    });
  });
  it("uses date as end when end is absent", () => {
    expect(itemDateRange("i2", cells, "d1")).toEqual({
      start: "2026-06-15",
      end: "2026-06-15",
    });
  });
  it("returns null when the item has no date cell", () => {
    expect(itemDateRange("i3", cells, "d1")).toBeNull();
  });
});
