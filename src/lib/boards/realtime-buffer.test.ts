import { describe, expect, it } from "vitest";
import { foldBoardEvents, type BoardRealtimeEvent } from "./realtime-buffer";
import type { BoardCache } from "./cache";

function emptyCache(over: Partial<BoardCache> = {}): BoardCache {
  return {
    board: { id: "b1" },
    groups: [],
    columns: [],
    items: [],
    cellValues: [],
    dependencies: [],
    attachments: [],
    timeEntries: [],
    relationLinks: [],
    mirrorTargetCells: [],
    mirrorTargetColumns: [],
    ...over,
  } as unknown as BoardCache;
}

function cellEvent(
  item_id: string,
  column_id: string,
  value: unknown,
  updated_at?: string,
): BoardRealtimeEvent {
  return {
    table: "cell_values",
    payload: {
      eventType: "UPDATE",
      new: { item_id, column_id, value, board_id: "b1", updated_at },
      old: {},
    } as never,
  };
}

describe("foldBoardEvents", () => {
  it("applies a cell upsert and emits one flash for the changed cell", () => {
    const { next, flashes } = foldBoardEvents(emptyCache(), [
      cellEvent("i1", "c1", { text: "hi" }),
    ]);
    expect(next.cellValues).toHaveLength(1);
    expect(flashes).toEqual([{ targetId: "cell:i1:c1", valueChanged: true }]);
  });

  it("echo-dedupes a cell whose value already matches (no change, no flash)", () => {
    const prev = emptyCache({
      cellValues: [
        { item_id: "i1", column_id: "c1", value: { text: "hi" } },
      ] as never,
    });
    const { next, flashes } = foldBoardEvents(prev, [
      cellEvent("i1", "c1", { text: "hi" }),
    ]);
    expect(next).toBe(prev); // unchanged reference → no re-render
    expect(flashes).toHaveLength(0);
  });

  it("applies multiple events in order (last write wins on the same cell)", () => {
    const { next } = foldBoardEvents(emptyCache(), [
      cellEvent("i1", "c1", { text: "a" }),
      cellEvent("i1", "c1", { text: "b" }),
    ]);
    const cell = next.cellValues.find(
      (c) => c.item_id === "i1" && c.column_id === "c1",
    );
    expect((cell?.value as { text: string }).text).toBe("b");
  });

  it("removes an item on DELETE", () => {
    const prev = emptyCache({ items: [{ id: "i1" }] as never });
    const ev: BoardRealtimeEvent = {
      table: "items",
      payload: { eventType: "DELETE", new: {}, old: { id: "i1" } } as never,
    };
    const { next } = foldBoardEvents(prev, [ev]);
    expect(next.items).toHaveLength(0);
  });

  it("removes a cell on DELETE (no flash emitted)", () => {
    const prev = emptyCache({
      cellValues: [
        { item_id: "i1", column_id: "c1", value: { text: "x" } },
      ] as never,
    });
    const ev: BoardRealtimeEvent = {
      table: "cell_values",
      payload: {
        eventType: "DELETE",
        new: {},
        old: { item_id: "i1", column_id: "c1" },
      } as never,
    };
    const { next, flashes } = foldBoardEvents(prev, [ev]);
    expect(next.cellValues).toHaveLength(0);
    expect(flashes).toHaveLength(0);
  });

  it("skips a stale cell echo whose updated_at is older than the cached row", () => {
    const prev = emptyCache({
      cellValues: [
        {
          item_id: "i1",
          column_id: "c1",
          value: { text: "new" },
          updated_at: "2026-07-04T12:00:05.000Z",
        },
      ] as never,
    });
    const { next, flashes } = foldBoardEvents(prev, [
      // Older own-write echo carrying a superseded value.
      cellEvent("i1", "c1", { text: "old" }, "2026-07-04T12:00:00.000Z"),
    ]);
    expect(next).toBe(prev); // unchanged reference → newer optimistic value kept
    expect(flashes).toHaveLength(0);
  });

  it("applies a newer cell echo over an older cached row", () => {
    const prev = emptyCache({
      cellValues: [
        {
          item_id: "i1",
          column_id: "c1",
          value: { text: "old" },
          updated_at: "2026-07-04T12:00:00.000Z",
        },
      ] as never,
    });
    const { next } = foldBoardEvents(prev, [
      cellEvent("i1", "c1", { text: "new" }, "2026-07-04T12:00:05.000Z"),
    ]);
    const cell = next.cellValues.find(
      (c) => c.item_id === "i1" && c.column_id === "c1",
    );
    expect((cell?.value as { text: string }).text).toBe("new");
  });

  it("applies an echo when updated_at is undefined (never silently drops)", () => {
    const prev = emptyCache({
      cellValues: [
        {
          item_id: "i1",
          column_id: "c1",
          value: { text: "old" },
          updated_at: "2026-07-04T12:00:00.000Z",
        },
      ] as never,
    });
    const { next } = foldBoardEvents(prev, [
      cellEvent("i1", "c1", { text: "new" }), // no updated_at on the incoming row
    ]);
    const cell = next.cellValues.find(
      (c) => c.item_id === "i1" && c.column_id === "c1",
    );
    expect((cell?.value as { text: string }).text).toBe("new");
  });

  it("folds an item UPDATE with archived_at set as a removal (archive reads as delete)", () => {
    const prev = emptyCache({
      items: [{ id: "i1", group_id: "g1", archived_at: null }] as never,
      cellValues: [
        { item_id: "i1", column_id: "c1", value: { text: "x" } },
      ] as never,
    });
    const ev: BoardRealtimeEvent = {
      table: "items",
      payload: {
        eventType: "UPDATE",
        new: { id: "i1", group_id: "g1", archived_at: "2026-07-06T00:00:00Z" },
        old: { id: "i1" },
      } as never,
    };
    const { next } = foldBoardEvents(prev, [ev]);
    expect(next.items.find((i) => i.id === "i1")).toBeUndefined();
    // cascade: the archived item's cell values are dropped too
    expect(next.cellValues.find((c) => c.item_id === "i1")).toBeUndefined();
  });

  it("folds an unarchive item UPDATE (archived_at null) for an absent item as an insert (peer restore)", () => {
    const prev = emptyCache({ items: [] as never });
    const ev: BoardRealtimeEvent = {
      table: "items",
      payload: {
        eventType: "UPDATE",
        new: { id: "i1", group_id: "g1", archived_at: null },
        old: { id: "i1" },
      } as never,
    };
    const { next } = foldBoardEvents(prev, [ev]);
    expect(next.items.find((i) => i.id === "i1")).toBeDefined();
  });

  it("folds a group UPDATE with archived_at set as a removal (cascades to its items)", () => {
    const prev = emptyCache({
      groups: [{ id: "g1", position: 0, archived_at: null }] as never,
      items: [{ id: "i1", group_id: "g1", archived_at: null }] as never,
    });
    const ev: BoardRealtimeEvent = {
      table: "groups",
      payload: {
        eventType: "UPDATE",
        new: { id: "g1", position: 0, archived_at: "2026-07-06T00:00:00Z" },
        old: { id: "g1" },
      } as never,
    };
    const { next } = foldBoardEvents(prev, [ev]);
    expect(next.groups.find((g) => g.id === "g1")).toBeUndefined();
    // removeGroup cascades: the group's items leave too
    expect(next.items.find((i) => i.id === "i1")).toBeUndefined();
  });

  it("folds an unarchive group UPDATE (archived_at null) for an absent group as an insert (peer restore)", () => {
    const prev = emptyCache({ groups: [] as never });
    const ev: BoardRealtimeEvent = {
      table: "groups",
      payload: {
        eventType: "UPDATE",
        new: { id: "g1", position: 0, archived_at: null },
        old: { id: "g1" },
      } as never,
    };
    const { next } = foldBoardEvents(prev, [ev]);
    expect(next.groups.find((g) => g.id === "g1")).toBeDefined();
  });

  it("mixed echo + real-change batch: one flash for the changed cell only", () => {
    const prev = emptyCache({
      cellValues: [
        { item_id: "i1", column_id: "c1", value: { text: "same" } },
      ] as never,
    });
    const { next, flashes } = foldBoardEvents(prev, [
      cellEvent("i1", "c1", { text: "same" }), // echo — value unchanged, no flash
      cellEvent("i2", "c1", { text: "new" }), // real change — new cell, emits flash
    ]);
    expect(flashes).toHaveLength(1);
    expect(flashes[0].targetId).toBe("cell:i2:c1");
    const i2Cell = next.cellValues.find(
      (c) => c.item_id === "i2" && c.column_id === "c1",
    );
    expect((i2Cell?.value as { text: string }).text).toBe("new");
  });
});
