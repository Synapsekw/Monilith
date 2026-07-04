import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the per-item server actions the bulk wrappers reuse. Each test drives the
// per-item outcomes and asserts the wrapper aggregates them correctly.
const deleteItem = vi.fn();
const moveItem = vi.fn();
const upsertCell = vi.fn();
const clearCell = vi.fn();

vi.mock("@/lib/boards/actions", () => ({
  deleteItem: (...a: unknown[]) => deleteItem(...a),
  moveItem: (...a: unknown[]) => moveItem(...a),
  upsertCell: (...a: unknown[]) => upsertCell(...a),
  clearCell: (...a: unknown[]) => clearCell(...a),
}));

import { bulkDeleteItems, bulkMoveItems, bulkSetCell } from "./bulk-actions";

const ok = { ok: true, data: undefined } as const;
// Valid v4-shaped UUIDs (version nibble 4, variant 8) so zod's `.uuid()` accepts
// them — the only thing under test here is the wrapper's aggregation, not ids.
const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("bulkDeleteItems", () => {
  it("reuses deleteItem per id and reports all succeeded", async () => {
    deleteItem.mockResolvedValue(ok);
    const res = await bulkDeleteItems({ itemIds: [uuid(1), uuid(2)] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.succeeded).toEqual([uuid(1), uuid(2)]);
    expect(res.data.failed).toEqual([]);
    expect(deleteItem).toHaveBeenCalledTimes(2);
    expect(deleteItem).toHaveBeenCalledWith({ itemId: uuid(1) });
  });

  it("collects per-item failures without aborting the batch (partial success)", async () => {
    deleteItem
      .mockResolvedValueOnce(ok)
      .mockResolvedValueOnce({ ok: false, error: "Item not found." })
      .mockResolvedValueOnce(ok);
    const res = await bulkDeleteItems({
      itemIds: [uuid(1), uuid(2), uuid(3)],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.succeeded).toEqual([uuid(1), uuid(3)]);
    expect(res.data.failed).toEqual([
      { itemId: uuid(2), error: "Item not found." },
    ]);
    // All three were attempted — one failure does not stop the rest.
    expect(deleteItem).toHaveBeenCalledTimes(3);
  });

  it("rejects a malformed request before any per-item work", async () => {
    const res = await bulkDeleteItems({ itemIds: ["not-a-uuid"] });
    expect(res.ok).toBe(false);
    expect(deleteItem).not.toHaveBeenCalled();
  });

  it("rejects an over-cap batch (bounded fan-out)", async () => {
    const ids = Array.from({ length: 501 }, (_, i) => uuid(i));
    const res = await bulkDeleteItems({ itemIds: ids });
    expect(res.ok).toBe(false);
    expect(deleteItem).not.toHaveBeenCalled();
  });
});

describe("bulkMoveItems", () => {
  it("reuses moveItem with the target group for every id", async () => {
    moveItem.mockResolvedValue(ok);
    const res = await bulkMoveItems({
      itemIds: [uuid(1), uuid(2)],
      groupId: uuid(9),
    });
    expect(res.ok).toBe(true);
    expect(moveItem).toHaveBeenCalledWith({
      itemId: uuid(1),
      groupId: uuid(9),
    });
    expect(moveItem).toHaveBeenCalledTimes(2);
  });
});

describe("bulkSetCell", () => {
  it("routes a value through upsertCell for each id", async () => {
    upsertCell.mockResolvedValue(ok);
    const res = await bulkSetCell({
      itemIds: [uuid(1), uuid(2)],
      columnId: uuid(9),
      value: { optionId: "done" },
    });
    expect(res.ok).toBe(true);
    expect(upsertCell).toHaveBeenCalledWith({
      itemId: uuid(1),
      columnId: uuid(9),
      value: { optionId: "done" },
    });
    expect(clearCell).not.toHaveBeenCalled();
  });

  it("routes a null value through clearCell for each id", async () => {
    clearCell.mockResolvedValue(ok);
    const res = await bulkSetCell({
      itemIds: [uuid(1)],
      columnId: uuid(9),
      value: null,
    });
    expect(res.ok).toBe(true);
    expect(clearCell).toHaveBeenCalledWith({
      itemId: uuid(1),
      columnId: uuid(9),
    });
    expect(upsertCell).not.toHaveBeenCalled();
  });
});
