import { describe, it, expect } from "vitest";
import {
  sortLinks,
  relationRollup,
  relationCellTexts,
  relationTextByCell,
  withRelationText,
  type RelationLink,
} from "./relations";
import { cellKey } from "./cache";

const mk = (id: string, pos: number): RelationLink => ({
  id,
  itemId: "i1",
  columnId: "c1",
  linkedItemId: `t-${id}`,
  linkedItemName: id,
  position: pos,
});

describe("relations helpers", () => {
  it("sorts by position", () => {
    const out = sortLinks([mk("b", 2), mk("a", 0), mk("c", 1)]);
    expect(out.map((l) => l.id)).toEqual(["a", "c", "b"]);
  });
  it("rollup counts distinct linked items", () => {
    expect(relationRollup([])).toBe("");
    expect(relationRollup([mk("a", 0)])).toBe("1 linked");
    expect(relationRollup([mk("a", 0), mk("b", 1), mk("c", 2)])).toBe(
      "3 linked",
    );
  });
});

const link = (
  itemId: string,
  columnId: string,
  name: string | null,
  position: number,
): RelationLink => ({
  id: `${itemId}-${columnId}-${position}`,
  itemId,
  columnId,
  linkedItemId: `t-${itemId}-${columnId}-${position}`,
  linkedItemName: name,
  position,
});

describe("relation cell text", () => {
  it("returns nothing for no links", () => {
    expect(relationCellTexts([])).toEqual([]);
    expect(relationTextByCell([]).size).toBe(0);
  });

  it("joins a cell's linked names with ', ' in position order", () => {
    const map = relationTextByCell([
      link("i1", "c1", "Gamma", 2),
      link("i1", "c1", "Alpha", 0),
      link("i1", "c1", "Beta", 1),
    ]);
    expect(map.get(cellKey("i1", "c1"))).toEqual({
      text: "Alpha, Beta, Gamma",
    });
  });

  it("skips links whose name is hidden (null)", () => {
    const map = relationTextByCell([
      link("i1", "c1", "Alpha", 0),
      link("i1", "c1", null, 1),
      link("i1", "c1", "Gamma", 2),
    ]);
    expect(map.get(cellKey("i1", "c1"))).toEqual({ text: "Alpha, Gamma" });
  });

  it("omits a cell whose links are all hidden", () => {
    const map = relationTextByCell([link("i1", "c1", null, 0)]);
    expect(map.has(cellKey("i1", "c1"))).toBe(false);
  });

  it("keeps cells apart by item and by column", () => {
    const texts = relationCellTexts([
      link("i1", "c1", "A", 0),
      link("i2", "c1", "B", 0),
      link("i1", "c2", "C", 0),
    ]);
    expect(texts).toEqual([
      { itemId: "i1", columnId: "c1", text: "A" },
      { itemId: "i2", columnId: "c1", text: "B" },
      { itemId: "i1", columnId: "c2", text: "C" },
    ]);
  });
});

describe("withRelationText", () => {
  it("overlays relation text without mutating the original map", () => {
    const original = new Map<string, unknown>([
      [cellKey("i1", "c-text"), { text: "hello" }],
    ]);
    const out = withRelationText(original, [link("i1", "c-rel", "Acme", 0)]);
    expect(out.get(cellKey("i1", "c-rel"))).toEqual({ text: "Acme" });
    expect(out.get(cellKey("i1", "c-text"))).toEqual({ text: "hello" });
    expect(original.has(cellKey("i1", "c-rel"))).toBe(false);
    expect(original.size).toBe(1);
  });

  it("returns the same map when there is nothing to overlay", () => {
    const original = new Map<string, unknown>();
    expect(withRelationText(original, [])).toBe(original);
    expect(withRelationText(original, [link("i1", "c1", null, 0)])).toBe(
      original,
    );
  });
});

describe("relationFitValues", () => {
  it("returns one text value per relation cell, keyed by column", async () => {
    const { relationFitValues } = await import("@/lib/boards/relations");
    const link = (
      id: string,
      itemId: string,
      name: string | null,
    ): RelationLink => ({
      id,
      itemId,
      columnId: "rc",
      linkedItemId: `t-${id}`,
      linkedItemName: name,
      position: 0,
    });
    expect(
      relationFitValues([
        link("a", "i1", "Handover accepted"),
        link("b", "i2", null),
      ]),
    ).toEqual([{ column_id: "rc", value: { text: "Handover accepted" } }]);
    expect(relationFitValues(undefined)).toEqual([]);
  });
});
