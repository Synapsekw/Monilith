import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the per-item server actions the bulk wrappers reuse. Each test drives the
// per-item outcomes and asserts the wrapper aggregates them correctly.
const moveItem = vi.fn();
const upsertCell = vi.fn();
const clearCell = vi.fn();
const archiveItem = vi.fn();
const restoreItem = vi.fn();

vi.mock("@/lib/boards/actions", () => ({
  moveItem: (...a: unknown[]) => moveItem(...a),
  upsertCell: (...a: unknown[]) => upsertCell(...a),
  clearCell: (...a: unknown[]) => clearCell(...a),
  archiveItem: (...a: unknown[]) => archiveItem(...a),
  restoreItem: (...a: unknown[]) => restoreItem(...a),
}));

import {
  bulkMoveItems,
  bulkSetCell,
  bulkArchiveItems,
  bulkRestoreItems,
} from "./bulk-actions";

const ok = { ok: true, data: undefined } as const;
// Valid v4-shaped UUIDs (version nibble 4, variant 8) so zod's `.uuid()` accepts
// them — the only thing under test here is the wrapper's aggregation, not ids.
const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("bulkArchiveItems", () => {
  it("reuses archiveItem per id and reports all succeeded", async () => {
    archiveItem.mockResolvedValue(ok);
    const res = await bulkArchiveItems({ itemIds: [uuid(1), uuid(2)] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.succeeded).toEqual([uuid(1), uuid(2)]);
    expect(res.data.failed).toEqual([]);
    expect(archiveItem).toHaveBeenCalledTimes(2);
    expect(archiveItem).toHaveBeenCalledWith({ itemId: uuid(1) });
  });

  it("rejects an over-cap batch (bounded fan-out)", async () => {
    const ids = Array.from({ length: 501 }, (_, i) => uuid(i));
    const res = await bulkArchiveItems({ itemIds: ids });
    expect(res.ok).toBe(false);
    expect(archiveItem).not.toHaveBeenCalled();
  });
});

describe("bulkRestoreItems", () => {
  it("reuses restoreItem per id", async () => {
    restoreItem.mockResolvedValue(ok);
    const res = await bulkRestoreItems({ itemIds: [uuid(1), uuid(2)] });
    expect(res.ok).toBe(true);
    expect(restoreItem).toHaveBeenCalledWith({ itemId: uuid(1) });
    expect(restoreItem).toHaveBeenCalledTimes(2);
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
