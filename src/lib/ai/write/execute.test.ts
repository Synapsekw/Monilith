import { describe, expect, it, vi, beforeEach } from "vitest";

const { createItem, createGroup, upsertCell } = vi.hoisted(() => ({
  createItem: vi.fn(async () => ({
    ok: true,
    data: { item: { id: "i9", board_id: "b1" } },
  })),
  createGroup: vi.fn(async () => ({ ok: true, data: { group: { id: "g9" } } })),
  upsertCell: vi.fn(async () => ({ ok: true, data: undefined })),
}));
vi.mock("@/lib/boards/actions/item", () => ({ createItem }));
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
    expect(res).toEqual({ ok: true, itemId: "i9" });
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
    expect(res).toEqual({ ok: false, error: "nope" });
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
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain("date");
    expect(createItem).toHaveBeenCalled();
  });

  it("create_group delegates to createGroup", async () => {
    const res = await executeAction({
      kind: "create_group",
      boardId: "b1",
      name: "Backlog",
      summary: "s",
      warnings: [],
    });
    expect(res).toEqual({ ok: true });
    expect(createGroup).toHaveBeenCalledWith({
      boardId: "b1",
      name: "Backlog",
    });
  });
});
