import { describe, expect, it } from "vitest";
import { applyBoardEffect } from "./ai-effects";
import type { BoardCache } from "./cache";
import type { BoardEffect } from "@/lib/ai/write/effects";

function baseCache(): BoardCache {
  return {
    board: { id: "b1", org_id: "o1", name: "B" } as BoardCache["board"],
    groups: [
      { id: "g1", board_id: "b1", name: "Backlog", position: 1 } as never,
    ],
    columns: [],
    items: [
      {
        id: "i1",
        board_id: "b1",
        group_id: "g1",
        parent_id: null,
        name: "One",
        position: 1,
      } as never,
    ],
    cellValues: [],
    dependencies: [],
    attachments: [],
    timeEntries: [],
    relationLinks: [],
    mirrorTargetCells: [],
    mirrorTargetColumns: [],
  };
}

const newItem = {
  id: "i9",
  board_id: "b1",
  group_id: "g1",
  parent_id: null,
  name: "Ship v2",
  position: 2,
} as never;

const newCell = {
  item_id: "i9",
  column_id: "c-due",
  org_id: "o1",
  board_id: "b1",
  value: { date: "2026-08-10" },
} as never;

describe("applyBoardEffect", () => {
  it("item_created inserts the item and its cells", () => {
    const next = applyBoardEffect(baseCache(), {
      kind: "item_created",
      boardId: "b1",
      item: newItem,
      cells: [newCell],
    });
    expect(next.items.map((i) => i.id)).toEqual(["i1", "i9"]);
    expect(next.cellValues).toHaveLength(1);
    expect(next.cellValues[0]?.column_id).toBe("c-due");
  });

  it("item_created is idempotent — applying twice does not duplicate", () => {
    const effect: BoardEffect = {
      kind: "item_created",
      boardId: "b1",
      item: newItem,
      cells: [newCell],
    };
    const once = applyBoardEffect(baseCache(), effect);
    const twice = applyBoardEffect(once, effect);
    expect(twice.items.filter((i) => i.id === "i9")).toHaveLength(1);
    expect(twice.cellValues).toHaveLength(1);
  });

  it("item_moved reassigns group and position, and drags subitems along", () => {
    const cache = baseCache();
    cache.groups.push({
      id: "g2",
      board_id: "b1",
      name: "Doing",
      position: 2,
    } as never);
    cache.items.push({
      id: "s1",
      board_id: "b1",
      group_id: "g1",
      parent_id: "i1",
      name: "Sub",
      position: 1,
    } as never);

    const next = applyBoardEffect(cache, {
      kind: "item_moved",
      boardId: "b1",
      item: { ...cache.items[0]!, group_id: "g2", position: 7 },
      subitemIds: ["s1"],
    });

    expect(next.items.find((i) => i.id === "i1")?.group_id).toBe("g2");
    expect(next.items.find((i) => i.id === "i1")?.position).toBe(7);
    expect(next.items.find((i) => i.id === "s1")?.group_id).toBe("g2");
    // The subitem keeps its own position — only its denormalized group moved.
    expect(next.items.find((i) => i.id === "s1")?.position).toBe(1);
  });

  it("item_moved for an item the cache has never seen leaves it untouched", () => {
    // A write to a board the user is looking at, but for a row outside the
    // loaded projection (archived / filtered). Must not invent a row.
    const cache = baseCache();
    const next = applyBoardEffect(cache, {
      kind: "item_moved",
      boardId: "b1",
      item: { ...(newItem as object), group_id: "g2" } as never,
      subitemIds: [],
    });
    expect(next.items.map((i) => i.id)).toEqual(["i1"]);
  });

  it("item_fields_set upserts cells, replacing an existing value", () => {
    const cache = baseCache();
    cache.cellValues.push({
      item_id: "i1",
      column_id: "c-due",
      org_id: "o1",
      board_id: "b1",
      value: { date: "2026-01-01" },
    } as never);

    const next = applyBoardEffect(cache, {
      kind: "item_fields_set",
      boardId: "b1",
      cells: [
        {
          item_id: "i1",
          column_id: "c-due",
          org_id: "o1",
          board_id: "b1",
          value: { date: "2026-12-31" },
        } as never,
      ],
    });

    expect(next.cellValues).toHaveLength(1);
    expect(next.cellValues[0]?.value).toEqual({ date: "2026-12-31" });
  });

  it("group_created inserts the group, idempotently", () => {
    const effect: BoardEffect = {
      kind: "group_created",
      boardId: "b1",
      group: { id: "g2", board_id: "b1", name: "Doing", position: 2 } as never,
    };
    const once = applyBoardEffect(baseCache(), effect);
    const twice = applyBoardEffect(once, effect);
    expect(twice.groups.map((g) => g.id)).toEqual(["g1", "g2"]);
  });

  it("returns the same cache reference when nothing applies", () => {
    const cache = baseCache();
    const next = applyBoardEffect(cache, {
      kind: "item_fields_set",
      boardId: "b1",
      cells: [],
    });
    expect(next).toBe(cache);
  });
});
