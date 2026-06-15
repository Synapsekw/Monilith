import { describe, expect, it } from "vitest";
import {
  insertItem,
  removeCellValue,
  replaceItem,
  upsertCellValue,
  type BoardCache,
} from "./cache";

function baseCache(): BoardCache {
  return {
    board: { id: "b1", org_id: "o1", name: "B" } as BoardCache["board"],
    groups: [],
    columns: [],
    items: [
      { id: "i1", board_id: "b1", group_id: "g1", name: "One" } as never,
      { id: "i2", board_id: "b1", group_id: "g1", name: "Two" } as never,
    ],
    cellValues: [
      {
        item_id: "i1",
        column_id: "c1",
        org_id: "o1",
        board_id: "b1",
        value: { text: "old" },
      } as never,
    ],
  };
}

describe("upsertCellValue", () => {
  it("replaces an existing cell value by (item_id, column_id)", () => {
    const next = upsertCellValue(baseCache(), {
      item_id: "i1",
      column_id: "c1",
      org_id: "o1",
      board_id: "b1",
      value: { text: "new" },
    } as never);
    const cell = next.cellValues.find(
      (c) => c.item_id === "i1" && c.column_id === "c1",
    );
    expect((cell!.value as { text: string }).text).toBe("new");
    expect(next.cellValues).toHaveLength(1);
  });

  it("inserts a new cell value when none exists", () => {
    const next = upsertCellValue(baseCache(), {
      item_id: "i2",
      column_id: "c1",
      org_id: "o1",
      board_id: "b1",
      value: { text: "x" },
    } as never);
    expect(next.cellValues).toHaveLength(2);
  });

  it("does not mutate the input cache (immutable)", () => {
    const input = baseCache();
    upsertCellValue(input, {
      item_id: "i1",
      column_id: "c1",
      org_id: "o1",
      board_id: "b1",
      value: { text: "new" },
    } as never);
    expect((input.cellValues[0].value as { text: string }).text).toBe("old");
  });
});

describe("removeCellValue", () => {
  it("removes the cell value for (item_id, column_id)", () => {
    const next = removeCellValue(baseCache(), "i1", "c1");
    expect(next.cellValues).toHaveLength(0);
  });

  it("is a no-op when the cell does not exist", () => {
    const next = removeCellValue(baseCache(), "i2", "c9");
    expect(next.cellValues).toHaveLength(1);
  });
});

describe("replaceItem", () => {
  it("replaces a matching item by id", () => {
    const next = replaceItem(baseCache(), {
      id: "i1",
      board_id: "b1",
      group_id: "g1",
      name: "Renamed",
    } as never);
    expect(next.items.find((i) => i.id === "i1")!.name).toBe("Renamed");
  });
});

describe("insertItem", () => {
  it("appends a new item", () => {
    const next = insertItem(baseCache(), {
      id: "i3",
      board_id: "b1",
      group_id: "g1",
      name: "Three",
    } as never);
    expect(next.items).toHaveLength(3);
  });

  it("is idempotent — does not duplicate an existing item id", () => {
    const next = insertItem(baseCache(), {
      id: "i1",
      board_id: "b1",
      group_id: "g1",
      name: "One",
    } as never);
    expect(next.items).toHaveLength(2);
  });
});
