import { describe, it, expect } from "vitest";
import type { CacheColumn } from "@/lib/boards/cache";
import { selectCardColumns, isCardCellEmpty } from "@/lib/boards/kanban-card";

function col(id: string, kind: string, position = 0): CacheColumn {
  return {
    id,
    board_id: "b1",
    org_id: "o1",
    kind,
    name: id,
    position,
    settings: {},
  } as unknown as CacheColumn;
}

describe("selectCardColumns", () => {
  const columns = [
    col("group", "status", 0),
    col("stakeholder", "status", 1),
    col("tags", "dropdown", 2),
    col("start", "date", 3),
    col("owner", "people", 4),
    col("progress", "percent", 5),
    col("score", "numbers", 6),
    col("notes", "text", 7),
    col("docs", "files", 8),
  ];

  it("splits status/dropdown into pills and date/people/percent/numbers into meta", () => {
    const { pills, meta } = selectCardColumns(columns, "group");
    expect(pills.map((c) => c.id)).toEqual(["stakeholder", "tags"]);
    expect(meta.map((c) => c.id)).toEqual([
      "start",
      "owner",
      "progress",
      "score",
    ]);
  });

  it("excludes the grouping column (it is represented by the lane)", () => {
    const { pills } = selectCardColumns(columns, "group");
    expect(pills.some((c) => c.id === "group")).toBe(false);
  });

  it("ignores kinds that don't belong on a card (text, files, …)", () => {
    const { pills, meta } = selectCardColumns(columns, "group");
    const ids = [...pills, ...meta].map((c) => c.id);
    expect(ids).not.toContain("notes");
    expect(ids).not.toContain("docs");
  });

  it("preserves board column order within each zone", () => {
    const reordered = [
      col("progress", "percent", 0),
      col("stakeholder", "status", 1),
      col("start", "date", 2),
      col("tags", "dropdown", 3),
    ];
    const { pills, meta } = selectCardColumns(reordered, "group");
    expect(pills.map((c) => c.id)).toEqual(["stakeholder", "tags"]);
    expect(meta.map((c) => c.id)).toEqual(["progress", "start"]);
  });
});

describe("isCardCellEmpty", () => {
  it("treats missing/null cells as empty for every kind", () => {
    for (const kind of [
      "status",
      "dropdown",
      "date",
      "people",
      "percent",
      "numbers",
    ]) {
      expect(isCardCellEmpty(kind, null)).toBe(true);
      expect(isCardCellEmpty(kind, undefined)).toBe(true);
    }
  });

  it("status: empty when optionId is null", () => {
    expect(isCardCellEmpty("status", { optionId: null })).toBe(true);
    expect(isCardCellEmpty("status", { optionId: "o1" })).toBe(false);
  });

  it("dropdown: empty when no optionIds", () => {
    expect(isCardCellEmpty("dropdown", { optionIds: [] })).toBe(true);
    expect(isCardCellEmpty("dropdown", { optionIds: ["a"] })).toBe(false);
  });

  it("date: empty when no date string", () => {
    expect(isCardCellEmpty("date", { date: "" })).toBe(true);
    expect(isCardCellEmpty("date", { date: "2026-06-10" })).toBe(false);
  });

  it("people: empty when no userIds", () => {
    expect(isCardCellEmpty("people", { userIds: [] })).toBe(true);
    expect(isCardCellEmpty("people", { userIds: ["u1"] })).toBe(false);
  });

  it("percent: empty when percent is not a number", () => {
    expect(isCardCellEmpty("percent", {})).toBe(true);
    expect(isCardCellEmpty("percent", { percent: 0 })).toBe(false);
    expect(isCardCellEmpty("percent", { percent: 40 })).toBe(false);
  });

  it("numbers: empty when value is null, present for 0", () => {
    expect(isCardCellEmpty("numbers", null)).toBe(true);
    expect(isCardCellEmpty("numbers", { n: 0 })).toBe(false);
  });

  it("currency: surfaces in card meta and detects empties", () => {
    const { meta } = selectCardColumns(
      [col("group", "status", 0), col("budget", "currency", 1)],
      "group",
    );
    expect(meta.map((c) => c.id)).toEqual(["budget"]);
    expect(isCardCellEmpty("currency", { amount: 3 })).toBe(false);
    expect(isCardCellEmpty("currency", { amount: 0 })).toBe(false);
    expect(isCardCellEmpty("currency", {})).toBe(true);
    expect(isCardCellEmpty("currency", null)).toBe(true);
  });
});
