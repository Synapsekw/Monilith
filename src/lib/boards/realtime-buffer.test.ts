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
): BoardRealtimeEvent {
  return {
    table: "cell_values",
    payload: {
      eventType: "UPDATE",
      new: { item_id, column_id, value, board_id: "b1" },
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
});
