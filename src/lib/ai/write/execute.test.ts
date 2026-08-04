import { describe, expect, it, vi, beforeEach } from "vitest";

const { createItem, createGroup, upsertCell, moveItem } = vi.hoisted(() => ({
  createItem: vi.fn(async () => ({
    ok: true,
    data: { item: { id: "i9", board_id: "b1", group_id: "g1" } },
  })),
  createGroup: vi.fn(async () => ({
    ok: true,
    data: { group: { id: "g9", board_id: "b1" } },
  })),
  upsertCell: vi.fn(async () => ({
    ok: true,
    data: { cell: { item_id: "i9", column_id: "c-due", value: {} } },
  })),
  moveItem: vi.fn(async () => ({
    ok: true,
    data: {
      item: { id: "i1", board_id: "b1", group_id: "g2", position: 7 },
      subitemIds: ["s1"],
    },
  })),
}));
vi.mock("@/lib/boards/actions/item", () => ({ createItem, moveItem }));
vi.mock("@/lib/boards/actions/group", () => ({ createGroup }));
vi.mock("@/lib/boards/actions/cell", () => ({ upsertCell }));
vi.mock("@/lib/boards/queries", () => ({
  getBoardPayload: vi.fn(async () => ({
    board: { id: "b1", name: "Roadmap" },
    groups: [{ id: "g1", name: "Backlog" }],
    columns: [
      { id: "c-due", name: "Due", kind: "date" },
      { id: "c-owner", name: "Owner", kind: "people" },
    ],
    items: [],
    cellValues: [],
  })),
}));

import { executeAction } from "./execute";

beforeEach(() => {
  createItem.mockClear();
  createGroup.mockClear();
  upsertCell.mockClear();
  moveItem.mockClear();
});

describe("executeAction", () => {
  it("create_item creates the item then upserts date + people cells", async () => {
    const res = await executeAction({
      kind: "create_item",
      boardId: "b1",
      groupId: "g1",
      name: "Ship v2",
      fields: { dueDate: "2026-07-17", ownerUserIds: ["u1"] },
      summary: "s",
      warnings: [],
    });
    expect(res.result).toEqual({ ok: true, itemId: "i9" });
    expect(createItem).toHaveBeenCalledWith({ groupId: "g1", name: "Ship v2" });
    expect(upsertCell).toHaveBeenCalledWith({
      itemId: "i9",
      columnId: "c-due",
      value: { date: "2026-07-17" },
    });
    expect(upsertCell).toHaveBeenCalledWith({
      itemId: "i9",
      columnId: "c-owner",
      value: { userIds: ["u1"] },
    });
  });

  it("reports failure when the item create fails", async () => {
    createItem.mockResolvedValueOnce({ ok: false, error: "nope" } as never);
    const res = await executeAction({
      kind: "create_item",
      boardId: "b1",
      groupId: "g1",
      name: "X",
      summary: "s",
      warnings: [],
    });
    expect(res.result).toEqual({ ok: false, error: "nope" });
    expect(res.effect).toBeNull();
  });

  it("surfaces a per-field error without failing the whole create", async () => {
    upsertCell.mockResolvedValueOnce({ ok: false, error: "denied" } as never);
    const res = await executeAction({
      kind: "create_item",
      boardId: "b1",
      groupId: "g1",
      name: "X",
      fields: { dueDate: "2026-07-17" },
      summary: "s",
      warnings: [],
    });
    // Item was created (i9) but the date field failed → overall not-ok with the field error.
    expect(res.result.ok).toBe(false);
    if (res.result.ok) return;
    expect(res.result.error).toContain("date");
    expect(createItem).toHaveBeenCalled();
    // The row exists regardless, so the board must still show it: the effect
    // rides ALONG with the error, not instead of it.
    expect(res.effect?.kind).toBe("item_created");
  });

  it("create_group delegates to createGroup", async () => {
    const res = await executeAction({
      kind: "create_group",
      boardId: "b1",
      name: "Backlog",
      summary: "s",
      warnings: [],
    });
    expect(res.result).toEqual({ ok: true });
    expect(createGroup).toHaveBeenCalledWith({
      boardId: "b1",
      name: "Backlog",
    });
  });
});

describe("executeAction — move_item", () => {
  it("delegates to moveItem with no position, so the item appends to the target group", async () => {
    const res = await executeAction({
      kind: "move_item",
      boardId: "b1",
      itemId: "i-qysea",
      groupId: "g-software",
      summary: 'Move "QYSEA" from Backlog to Software',
      warnings: [],
    });
    expect(moveItem).toHaveBeenCalledWith({
      itemId: "i-qysea",
      groupId: "g-software",
    });
    // No itemId: QuickAction reads an ok-result carrying one as "Created —
    // open it from the board", which is the wrong sentence for a move.
    expect(res.result).toEqual({ ok: true });
  });

  it("surfaces moveItem's refusal verbatim rather than a generic failure", async () => {
    // moveItem is the enforcement: it re-checks the board under RLS after the
    // user confirms, so its error is the one that matters and must not be
    // swallowed or reworded.
    moveItem.mockResolvedValueOnce({
      ok: false,
      error: "Group belongs to a different board.",
    } as never);
    const res = await executeAction({
      kind: "move_item",
      boardId: "b1",
      itemId: "i-qysea",
      groupId: "g-elsewhere",
      summary: "Move …",
      warnings: [],
    });
    expect(res.result).toEqual({
      ok: false,
      error: "Group belongs to a different board.",
    });
  });

  it("never touches the cell writer — a move changes no field values", async () => {
    await executeAction({
      kind: "move_item",
      boardId: "b1",
      itemId: "i-qysea",
      groupId: "g-software",
      summary: "Move …",
      warnings: [],
    });
    expect(upsertCell).not.toHaveBeenCalled();
  });
});

// The whole point of the seam: every verb hands back the authoritative rows it
// produced, so the acting client can render its own change with no refetch.
describe("executeAction — board effects", () => {
  it("move_item reports the moved row and its subitems as an effect", async () => {
    const res = await executeAction({
      kind: "move_item",
      boardId: "b1",
      itemId: "i1",
      groupId: "g2",
      summary: "s",
      warnings: [],
    });
    expect(res.result).toEqual({ ok: true });
    expect(res.effect).toEqual({
      kind: "item_moved",
      boardId: "b1",
      item: { id: "i1", board_id: "b1", group_id: "g2", position: 7 },
      subitemIds: ["s1"],
    });
  });

  it("create_item reports the created row and the cells its fields wrote", async () => {
    const res = await executeAction({
      kind: "create_item",
      boardId: "b1",
      groupId: "g1",
      name: "Ship v2",
      fields: { dueDate: "2026-07-17" },
      summary: "s",
      warnings: [],
    });
    expect(res.result).toEqual({ ok: true, itemId: "i9" });
    expect(res.effect?.kind).toBe("item_created");
    if (res.effect?.kind !== "item_created") return;
    expect(res.effect.item.id).toBe("i9");
    expect(res.effect.cells).toHaveLength(1);
  });

  it("create_item with no fields still reports the row, with no cells", async () => {
    const res = await executeAction({
      kind: "create_item",
      boardId: "b1",
      groupId: "g1",
      name: "Ship v2",
      summary: "s",
      warnings: [],
    });
    expect(res.effect?.kind).toBe("item_created");
    if (res.effect?.kind !== "item_created") return;
    expect(res.effect.cells).toEqual([]);
  });

  it("create_group reports the created group as an effect", async () => {
    const res = await executeAction({
      kind: "create_group",
      boardId: "b1",
      name: "Doing",
      summary: "s",
      warnings: [],
    });
    expect(res.result).toEqual({ ok: true });
    expect(res.effect).toEqual({
      kind: "group_created",
      boardId: "b1",
      group: { id: "g9", board_id: "b1" },
    });
  });

  it("set_item_fields reports the written cells", async () => {
    const res = await executeAction({
      kind: "set_item_fields",
      boardId: "b1",
      itemId: "i9",
      fields: { dueDate: "2026-07-17" },
      summary: "s",
      warnings: [],
    });
    expect(res.result).toEqual({ ok: true, itemId: "i9" });
    expect(res.effect?.kind).toBe("item_fields_set");
    if (res.effect?.kind !== "item_fields_set") return;
    expect(res.effect.cells).toHaveLength(1);
  });

  it("set_item_fields carries no effect when nothing was written", async () => {
    upsertCell.mockResolvedValueOnce({ ok: false, error: "denied" } as never);
    const res = await executeAction({
      kind: "set_item_fields",
      boardId: "b1",
      itemId: "i9",
      fields: { dueDate: "2026-07-17" },
      summary: "s",
      warnings: [],
    });
    expect(res.result.ok).toBe(false);
    expect(res.effect).toBeNull();
  });

  it("carries no effect when the underlying action fails", async () => {
    moveItem.mockResolvedValueOnce({ ok: false, error: "nope" } as never);
    const res = await executeAction({
      kind: "move_item",
      boardId: "b1",
      itemId: "i1",
      groupId: "g2",
      summary: "s",
      warnings: [],
    });
    expect(res.result).toEqual({ ok: false, error: "nope" });
    expect(res.effect).toBeNull();
  });

  it("keeps rows OUT of the persisted result", async () => {
    // ExecutionResult is written into ai_messages.tool_trace and read back on
    // every thread open — a row in there would bloat the thread and replay
    // stale state onto the board later. Effects travel BESIDE it.
    const res = await executeAction({
      kind: "move_item",
      boardId: "b1",
      itemId: "i1",
      groupId: "g2",
      summary: "s",
      warnings: [],
    });
    expect(JSON.stringify(res.result)).not.toContain("board_id");
    expect(Object.keys(res.result)).toEqual(["ok"]);
  });
});
