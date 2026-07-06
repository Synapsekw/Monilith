import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const upsertCell = vi.fn();
const clearCell = vi.fn();
const createGroup = vi.fn();
const reorderGroup = vi.fn();
const updateGroupColor = vi.fn();
const deleteGroup = vi.fn();
const createColumn = vi.fn();
const createItem = vi.fn();
const reorderColumn = vi.fn();
const deleteItem = vi.fn();
const renameItem = vi.fn();
const moveItem = vi.fn();
vi.mock("@/lib/boards/actions", () => ({
  upsertCell: (...a: unknown[]) => upsertCell(...a),
  clearCell: (...a: unknown[]) => clearCell(...a),
  createGroup: (...a: unknown[]) => createGroup(...a),
  reorderGroup: (...a: unknown[]) => reorderGroup(...a),
  updateGroupColor: (...a: unknown[]) => updateGroupColor(...a),
  deleteGroup: (...a: unknown[]) => deleteGroup(...a),
  createColumn: (...a: unknown[]) => createColumn(...a),
  createItem: (...a: unknown[]) => createItem(...a),
  reorderColumn: (...a: unknown[]) => reorderColumn(...a),
  deleteItem: (...a: unknown[]) => deleteItem(...a),
  renameItem: (...a: unknown[]) => renameItem(...a),
  moveItem: (...a: unknown[]) => moveItem(...a),
}));

const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { error: (...a: unknown[]) => toastError(...a) },
}));

const createDependency = vi.fn();
const deleteDependency = vi.fn();
vi.mock("@/lib/boards/dependency-actions", () => ({
  createDependency: (...a: unknown[]) => createDependency(...a),
  deleteDependency: (...a: unknown[]) => deleteDependency(...a),
}));

const startTimerFn = vi.fn();
const stopTimerFn = vi.fn();
const addManualEntryFn = vi.fn();
const editEntryFn = vi.fn();
const deleteEntryFn = vi.fn();
const setEstimateFn = vi.fn();
vi.mock("@/lib/boards/time-actions", () => ({
  startTimer: (...a: unknown[]) => startTimerFn(...a),
  stopTimer: (...a: unknown[]) => stopTimerFn(...a),
  addManualEntry: (...a: unknown[]) => addManualEntryFn(...a),
  editEntry: (...a: unknown[]) => editEntryFn(...a),
  deleteEntry: (...a: unknown[]) => deleteEntryFn(...a),
  setEstimate: (...a: unknown[]) => setEstimateFn(...a),
}));

import {
  useBoardMutations,
  stripOption,
  pickFields,
} from "./use-board-mutations";
import { boardKey } from "./use-board-cache";
import { upsertCellValue } from "./cache";
import type {
  BoardCache,
  CacheCellValue,
  CacheDependency,
  CacheTimeEntry,
} from "./cache";

describe("stripOption", () => {
  function cell(value: CacheCellValue["value"]): CacheCellValue {
    return {
      item_id: "i1",
      column_id: "c1",
      org_id: "o1",
      board_id: "b1",
      value,
    } as CacheCellValue;
  }

  it("clears a status cell referencing the removed option (→ null)", () => {
    expect(stripOption(cell({ optionId: "opt-1" }), "opt-1")).toBeNull();
  });

  it("keeps a status cell pointing at a different option", () => {
    const c = cell({ optionId: "opt-2" });
    expect(stripOption(c, "opt-1")).toBe(c);
  });

  it("strips one id from a dropdown cell, keeping the rest", () => {
    const out = stripOption(cell({ optionIds: ["opt-1", "opt-2"] }), "opt-1");
    expect(out).not.toBeNull();
    expect((out!.value as { optionIds: string[] }).optionIds).toEqual([
      "opt-2",
    ]);
  });

  it("returns null for a dropdown cell emptied by the removal", () => {
    expect(stripOption(cell({ optionIds: ["opt-1"] }), "opt-1")).toBeNull();
  });
});

const DEP_ID = "dep1dep1-dep1-4dep-8dep-dep1dep1dep1";

function seedCache(qc: QueryClient): BoardCache {
  const cache: BoardCache = {
    board: { id: "b1", org_id: "o1", name: "B" } as never,
    groups: [],
    columns: [],
    items: [{ id: "i1", board_id: "b1", group_id: "g1", name: "One" } as never],
    cellValues: [],
    dependencies: [
      {
        id: DEP_ID,
        org_id: "o1",
        board_id: "b1",
        predecessor_id: "i1",
        successor_id: "i2",
        type: "FS",
        created_at: "2026-06-16T00:00:00Z",
      } as CacheDependency,
    ],
    attachments: [],
    timeEntries: [],
    relationLinks: [],
    mirrorTargetCells: [],
    mirrorTargetColumns: [],
  };
  qc.setQueryData(boardKey("b1"), cache);
  return cache;
}

function wrapper(qc: QueryClient) {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  Wrapper.displayName = "TestWrapper";
  return Wrapper;
}

describe("useBoardMutations.setCell", () => {
  beforeEach(() => {
    upsertCell.mockReset();
    clearCell.mockReset();
    createGroup.mockReset();
    createDependency.mockReset();
    deleteDependency.mockReset();
  });

  it("optimistically writes the cell value into the cache on mutate", async () => {
    const qc = new QueryClient();
    seedCache(qc);
    upsertCell.mockResolvedValue({ ok: true, data: undefined });

    const { result } = renderHook(() => useBoardMutations("b1"), {
      wrapper: wrapper(qc),
    });

    await act(async () => {
      result.current.setCell({
        itemId: "i1",
        columnId: "c1",
        value: { text: "hi" },
      });
    });

    const cache = qc.getQueryData<BoardCache>(boardKey("b1"))!;
    const cell = cache.cellValues.find(
      (c) => c.item_id === "i1" && c.column_id === "c1",
    );
    expect((cell!.value as { text: string }).text).toBe("hi");
  });

  it("rolls back the cache when the action fails", async () => {
    const qc = new QueryClient();
    seedCache(qc);
    upsertCell.mockResolvedValue({ ok: false, error: "boom" });

    const { result } = renderHook(() => useBoardMutations("b1"), {
      wrapper: wrapper(qc),
    });

    await act(async () => {
      result.current.setCell({
        itemId: "i1",
        columnId: "c1",
        value: { text: "hi" },
      });
    });

    await waitFor(() => {
      const cache = qc.getQueryData<BoardCache>(boardKey("b1"))!;
      expect(cache.cellValues).toHaveLength(0);
    });
  });
});

describe("useBoardMutations.removeDependency", () => {
  beforeEach(() => {
    deleteDependency.mockReset();
  });

  it("optimistically removes the dependency from the cache", async () => {
    const qc = new QueryClient();
    seedCache(qc);
    deleteDependency.mockResolvedValue({ ok: true, data: undefined });

    const { result } = renderHook(() => useBoardMutations("b1"), {
      wrapper: wrapper(qc),
    });

    await act(async () => {
      result.current.removeDependency({ dependencyId: DEP_ID });
    });

    const cache = qc.getQueryData<BoardCache>(boardKey("b1"))!;
    expect(cache.dependencies).toHaveLength(0);
  });

  it("rolls back when deleteDependency fails", async () => {
    const qc = new QueryClient();
    seedCache(qc);
    deleteDependency.mockResolvedValue({ ok: false, error: "boom" });

    const { result } = renderHook(() => useBoardMutations("b1"), {
      wrapper: wrapper(qc),
    });

    await act(async () => {
      result.current.removeDependency({ dependencyId: DEP_ID });
    });

    await waitFor(() => {
      const cache = qc.getQueryData<BoardCache>(boardKey("b1"))!;
      expect(cache.dependencies).toHaveLength(1);
    });
  });
});

describe("useBoardMutations.addDependency", () => {
  const PRED_ID = "11111111-1111-4111-8111-111111111111";
  const SUCC_ID = "22222222-2222-4222-8222-222222222222";

  beforeEach(() => {
    createDependency.mockReset();
  });

  it("calls createDependency action (no optimistic insert)", async () => {
    const qc = new QueryClient();
    seedCache(qc);
    createDependency.mockResolvedValue({
      ok: true,
      data: { dependencyId: "new-dep" },
    });

    const { result } = renderHook(() => useBoardMutations("b1"), {
      wrapper: wrapper(qc),
    });

    await act(async () => {
      result.current.addDependency({
        predecessorId: PRED_ID,
        successorId: SUCC_ID,
      });
    });

    await waitFor(() => {
      expect(createDependency).toHaveBeenCalledWith({
        predecessorId: PRED_ID,
        successorId: SUCC_ID,
      });
    });

    // Cache is NOT updated (realtime handles it)
    const cache = qc.getQueryData<BoardCache>(boardKey("b1"))!;
    expect(cache.dependencies).toHaveLength(1); // unchanged from seed
  });

  it("surfaces errors via onError callback", async () => {
    const qc = new QueryClient();
    seedCache(qc);
    createDependency.mockResolvedValue({
      ok: false,
      error: "this would create a dependency cycle",
    });

    const onError = vi.fn();
    const { result } = renderHook(() => useBoardMutations("b1"), {
      wrapper: wrapper(qc),
    });

    await act(async () => {
      result.current.addDependency(
        { predecessorId: PRED_ID, successorId: SUCC_ID },
        { onError },
      );
    });

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "this would create a dependency cycle",
        }),
      );
    });
  });
});

describe("useBoardMutations.addColumn", () => {
  beforeEach(() => {
    createColumn.mockReset();
  });

  it("inserts the created column into the cache on success", async () => {
    const qc = new QueryClient();
    seedCache(qc); // columns: []
    createColumn.mockResolvedValue({
      ok: true,
      data: {
        column: {
          id: "col-pct",
          board_id: "b1",
          org_id: "o1",
          kind: "percent",
          name: "Percent",
          settings: {},
          position: 1,
        },
      },
    });

    const { result } = renderHook(() => useBoardMutations("b1"), {
      wrapper: wrapper(qc),
    });

    await act(async () => {
      result.current.addColumn("percent");
    });

    await waitFor(() => {
      const cache = qc.getQueryData<BoardCache>(boardKey("b1"))!;
      expect(cache.columns.map((c) => c.id)).toContain("col-pct");
    });
    expect(createColumn).toHaveBeenCalledWith({
      boardId: "b1",
      kind: "percent",
      settings: undefined,
    });
  });

  it("surfaces errors via onError callback and leaves the cache untouched", async () => {
    const qc = new QueryClient();
    seedCache(qc); // columns: []
    createColumn.mockResolvedValue({ ok: false, error: "boom" });

    const onError = vi.fn();
    const { result } = renderHook(() => useBoardMutations("b1"), {
      wrapper: wrapper(qc),
    });

    await act(async () => {
      result.current.addColumn("percent", undefined, { onError });
    });

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ message: "boom" }),
      );
    });

    // Patch-on-success (no optimistic insert), so a failure leaves columns empty.
    const cache = qc.getQueryData<BoardCache>(boardKey("b1"))!;
    expect(cache.columns).toHaveLength(0);
  });
});

describe("useBoardMutations.addGroup", () => {
  beforeEach(() => {
    createGroup.mockReset();
  });

  it("inserts the created group into the cache and forwards the new id", async () => {
    const qc = new QueryClient();
    seedCache(qc); // groups: []
    createGroup.mockResolvedValue({
      ok: true,
      data: {
        group: {
          id: "g2",
          board_id: "b1",
          org_id: "o1",
          name: "Group 2",
          color: "#0073ea",
          position: 1,
        },
      },
    });

    const onSuccess = vi.fn();
    const { result } = renderHook(() => useBoardMutations("b1"), {
      wrapper: wrapper(qc),
    });

    await act(async () => {
      result.current.addGroup("Group 2", { onSuccess });
    });

    await waitFor(() => {
      const cache = qc.getQueryData<BoardCache>(boardKey("b1"))!;
      expect(cache.groups.map((g) => g.id)).toContain("g2");
    });
    expect(createGroup).toHaveBeenCalledWith({
      boardId: "b1",
      name: "Group 2",
    });
    expect(onSuccess).toHaveBeenCalledWith("g2");
  });

  it("surfaces errors via onError callback and leaves the cache untouched", async () => {
    const qc = new QueryClient();
    seedCache(qc); // groups: []
    createGroup.mockResolvedValue({ ok: false, error: "boom" });

    const onError = vi.fn();
    const { result } = renderHook(() => useBoardMutations("b1"), {
      wrapper: wrapper(qc),
    });

    await act(async () => {
      result.current.addGroup("Group 2", { onError });
    });

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ message: "boom" }),
      );
    });

    // No optimistic add, so nothing to roll back — cache stays empty.
    const cache = qc.getQueryData<BoardCache>(boardKey("b1"))!;
    expect(cache.groups).toHaveLength(0);
  });
});

function seedGroups(qc: QueryClient): void {
  qc.setQueryData(boardKey("b1"), {
    board: { id: "b1", org_id: "o1", name: "B" },
    groups: [
      { id: "g1", board_id: "b1", name: "G1", color: "#0073ea", position: 0 },
      { id: "g2", board_id: "b1", name: "G2", color: "#0073ea", position: 1 },
    ],
    columns: [],
    items: [{ id: "i1", board_id: "b1", group_id: "g1", name: "One" }],
    cellValues: [],
    dependencies: [],
    attachments: [],
  } as never);
}

describe("useBoardMutations.moveItemToGroup", () => {
  beforeEach(() => moveItem.mockReset());

  function seedWithSubitem(qc: QueryClient): void {
    qc.setQueryData(boardKey("b1"), {
      board: { id: "b1", org_id: "o1", name: "B" },
      groups: [
        { id: "g1", board_id: "b1", name: "G1", color: "#0073ea", position: 0 },
        { id: "g2", board_id: "b1", name: "G2", color: "#0073ea", position: 1 },
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
        },
        {
          id: "i1-sub",
          board_id: "b1",
          group_id: "g1",
          parent_id: "i1",
          name: "Sub",
          position: 1,
        },
      ],
      cellValues: [],
      dependencies: [],
      attachments: [],
    } as never);
  }

  it("optimistically reassigns group + position (dragging subitems along) and calls the action", async () => {
    const qc = new QueryClient();
    seedWithSubitem(qc);
    moveItem.mockResolvedValue({ ok: true, data: undefined });
    const { result } = renderHook(() => useBoardMutations("b1"), {
      wrapper: wrapper(qc),
    });

    await act(async () => {
      result.current.moveItemToGroup("i1", "g2", 4.5);
    });

    const cache = qc.getQueryData<BoardCache>(boardKey("b1"))!;
    const moved = cache.items.find((i) => i.id === "i1")!;
    expect(moved.group_id).toBe("g2");
    expect(moved.position).toBe(4.5);
    const sub = cache.items.find((i) => i.id === "i1-sub")!;
    expect(sub.group_id).toBe("g2");

    expect(moveItem).toHaveBeenCalledWith({
      itemId: "i1",
      groupId: "g2",
      position: 4.5,
    });
  });

  it("rolls back the item's + subitem's group_id/position on error", async () => {
    const qc = new QueryClient();
    seedWithSubitem(qc);
    moveItem.mockResolvedValue({ ok: false, error: "boom" });
    const { result } = renderHook(() => useBoardMutations("b1"), {
      wrapper: wrapper(qc),
    });

    await act(async () => {
      result.current.moveItemToGroup("i1", "g2", 4.5);
    });

    await waitFor(() => {
      const cache = qc.getQueryData<BoardCache>(boardKey("b1"))!;
      const moved = cache.items.find((i) => i.id === "i1")!;
      expect(moved.group_id).toBe("g1");
      expect(moved.position).toBe(1);
      const sub = cache.items.find((i) => i.id === "i1-sub")!;
      expect(sub.group_id).toBe("g1");
    });
  });
});

describe("useBoardMutations.reorderGroup", () => {
  beforeEach(() => reorderGroup.mockReset());

  it("optimistically moves the group and re-sorts", async () => {
    const qc = new QueryClient();
    seedGroups(qc);
    reorderGroup.mockResolvedValue({ ok: true, data: undefined });
    const { result } = renderHook(() => useBoardMutations("b1"), {
      wrapper: wrapper(qc),
    });

    await act(async () => {
      result.current.reorderGroup("g1", 2);
    });

    const cache = qc.getQueryData<BoardCache>(boardKey("b1"))!;
    expect(cache.groups.map((g) => g.id)).toEqual(["g2", "g1"]);
    expect(reorderGroup).toHaveBeenCalledWith({ groupId: "g1", position: 2 });
  });

  it("rolls back when the action fails", async () => {
    const qc = new QueryClient();
    seedGroups(qc);
    reorderGroup.mockResolvedValue({ ok: false, error: "boom" });
    const { result } = renderHook(() => useBoardMutations("b1"), {
      wrapper: wrapper(qc),
    });

    await act(async () => {
      result.current.reorderGroup("g1", 2);
    });

    await waitFor(() => {
      const cache = qc.getQueryData<BoardCache>(boardKey("b1"))!;
      expect(cache.groups.map((g) => g.id)).toEqual(["g1", "g2"]);
    });
  });
});

function seedColumns(qc: QueryClient): void {
  const colBase = {
    org_id: "o1",
    board_id: "b1",
    kind: "text",
    settings: {},
    width: null,
    created_at: "2026-07-03T00:00:00Z",
    updated_at: "2026-07-03T00:00:00Z",
  };
  qc.setQueryData(boardKey("b1"), {
    board: { id: "b1", org_id: "o1", name: "B" },
    groups: [],
    columns: [
      { id: "c1", name: "C1", position: 0, ...colBase },
      { id: "c2", name: "C2", position: 1, ...colBase },
    ],
    items: [],
    cellValues: [],
    dependencies: [],
    attachments: [],
  } as never);
}

describe("useBoardMutations.reorderColumn", () => {
  beforeEach(() => reorderColumn.mockReset());

  it("optimistically moves the column and re-sorts", async () => {
    const qc = new QueryClient();
    seedColumns(qc); // c1 @ 0, c2 @ 1
    reorderColumn.mockResolvedValue({ ok: true, data: undefined });

    const { result } = renderHook(() => useBoardMutations("b1"), {
      wrapper: wrapper(qc),
    });

    await act(async () => {
      result.current.reorderColumn("c2", -1); // drop c2 before c1
    });

    const cache = qc.getQueryData<BoardCache>(boardKey("b1"))!;
    expect(cache.columns.map((c) => c.id)).toEqual(["c2", "c1"]);
    await waitFor(() =>
      expect(reorderColumn).toHaveBeenCalledWith({
        columnId: "c2",
        position: -1,
      }),
    );
  });

  it("rolls back on failure", async () => {
    const qc = new QueryClient();
    seedColumns(qc);
    reorderColumn.mockResolvedValue({ ok: false, error: "nope" });

    const { result } = renderHook(() => useBoardMutations("b1"), {
      wrapper: wrapper(qc),
    });

    await act(async () => {
      result.current.reorderColumn("c2", -1);
    });

    await waitFor(() => {
      const cache = qc.getQueryData<BoardCache>(boardKey("b1"))!;
      expect(cache.columns.map((c) => c.id)).toEqual(["c1", "c2"]);
    });
  });
});

describe("useBoardMutations.setGroupColor", () => {
  beforeEach(() => updateGroupColor.mockReset());

  it("optimistically updates the color", async () => {
    const qc = new QueryClient();
    seedGroups(qc);
    updateGroupColor.mockResolvedValue({ ok: true, data: undefined });
    const { result } = renderHook(() => useBoardMutations("b1"), {
      wrapper: wrapper(qc),
    });

    await act(async () => {
      result.current.setGroupColor("g1", "#00c875");
    });

    const cache = qc.getQueryData<BoardCache>(boardKey("b1"))!;
    expect(cache.groups.find((g) => g.id === "g1")!.color).toBe("#00c875");
    expect(updateGroupColor).toHaveBeenCalledWith({
      groupId: "g1",
      color: "#00c875",
    });
  });
});

describe("useBoardMutations.deleteGroup", () => {
  beforeEach(() => deleteGroup.mockReset());

  it("optimistically removes the group and its items", async () => {
    const qc = new QueryClient();
    seedGroups(qc);
    deleteGroup.mockResolvedValue({ ok: true, data: undefined });
    const { result } = renderHook(() => useBoardMutations("b1"), {
      wrapper: wrapper(qc),
    });

    await act(async () => {
      result.current.deleteGroup("g1");
    });

    const cache = qc.getQueryData<BoardCache>(boardKey("b1"))!;
    expect(cache.groups.map((g) => g.id)).toEqual(["g2"]);
    expect(cache.items).toHaveLength(0);
    expect(deleteGroup).toHaveBeenCalledWith({ groupId: "g1" });
  });

  it("resyncs from the server (invalidateQueries) when the cascade delete fails", async () => {
    const qc = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    seedGroups(qc);
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    deleteGroup.mockResolvedValue({ ok: false, error: "boom" });
    const { result } = renderHook(() => useBoardMutations("b1"), {
      wrapper: wrapper(qc),
    });

    await act(async () => {
      result.current.deleteGroup("g1");
    });

    // Cascade deletes resync from the server on failure rather than restore a
    // stale whole-cache snapshot (which would clobber concurrent peer changes).
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: boardKey("b1") }),
    );
  });
});

// ─── Time-tracking mutation tests ─────────────────────────────────────────────

const ENTRY_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

function makeEntry(overrides?: Partial<CacheTimeEntry>): CacheTimeEntry {
  return {
    id: ENTRY_ID,
    org_id: "o1",
    board_id: "b1",
    item_id: "i1",
    column_id: "col1",
    user_id: "u1",
    started_at: "2026-06-20T12:00:00.000Z",
    ended_at: "2026-06-20T13:00:00.000Z",
    duration_secs: 3600,
    created_at: "2026-06-20T12:00:00.000Z",
    ...overrides,
  } as CacheTimeEntry;
}

function seedWithEntries(qc: QueryClient): BoardCache {
  const cache: BoardCache = {
    board: { id: "b1", org_id: "o1", name: "B" } as never,
    groups: [],
    columns: [],
    relationLinks: [],
    items: [{ id: "i1", board_id: "b1", group_id: "g1", name: "One" } as never],
    cellValues: [],
    dependencies: [],
    attachments: [],
    timeEntries: [makeEntry()],
    mirrorTargetCells: [],
    mirrorTargetColumns: [],
  };
  qc.setQueryData(boardKey("b1"), cache);
  return cache;
}

describe("useBoardMutations.deleteEntry", () => {
  beforeEach(() => deleteEntryFn.mockReset());

  it("optimistically removes the time entry from cache", async () => {
    const qc = new QueryClient();
    seedWithEntries(qc);
    deleteEntryFn.mockResolvedValue({ ok: true, data: { id: ENTRY_ID } });

    const { result } = renderHook(() => useBoardMutations("b1"), {
      wrapper: wrapper(qc),
    });

    await act(async () => {
      result.current.deleteEntry(ENTRY_ID);
    });

    const cache = qc.getQueryData<BoardCache>(boardKey("b1"))!;
    expect(cache.timeEntries).toHaveLength(0);
    expect(deleteEntryFn).toHaveBeenCalledWith({ entryId: ENTRY_ID });
  });

  it("rolls back the time entry when the action fails", async () => {
    const qc = new QueryClient();
    seedWithEntries(qc);
    deleteEntryFn.mockResolvedValue({ ok: false, error: "not found" });

    const { result } = renderHook(() => useBoardMutations("b1"), {
      wrapper: wrapper(qc),
    });

    await act(async () => {
      result.current.deleteEntry(ENTRY_ID);
    });

    await waitFor(() => {
      const cache = qc.getQueryData<BoardCache>(boardKey("b1"))!;
      expect(cache.timeEntries).toHaveLength(1);
      expect(cache.timeEntries[0].id).toBe(ENTRY_ID);
    });
  });
});

describe("mutation error toasts", () => {
  beforeEach(() => {
    toastError.mockReset();
    upsertCell.mockReset();
    createItem.mockReset();
  });

  it("toasts and rolls back when setCell fails", async () => {
    upsertCell.mockResolvedValue({ ok: false, error: "boom" });
    const qc = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    const before = seedCache(qc);
    const { result } = renderHook(() => useBoardMutations("b1"), {
      wrapper: wrapper(qc),
    });

    act(() => {
      result.current.setCell({
        itemId: "i1",
        columnId: "c1",
        value: { text: "x" },
      });
    });

    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    expect(toastError).toHaveBeenCalledWith(
      "Couldn't save the cell — your change was undone.",
      { description: "boom" },
    );
    // rollback still happens
    expect(qc.getQueryData(boardKey("b1"))).toEqual(before);
  });

  it("toasts when a silent non-optimistic mutation fails (startTimer)", async () => {
    startTimerFn.mockReset();
    startTimerFn.mockResolvedValue({ ok: false, error: "boom" });
    const qc = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    seedCache(qc);
    const { result } = renderHook(() => useBoardMutations("b1"), {
      wrapper: wrapper(qc),
    });

    act(() => {
      result.current.startTimer("i1", "col1");
    });

    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    expect(toastError).toHaveBeenCalledWith("Couldn't start the timer.", {
      description: "boom",
    });
  });

  it("does NOT toast for callback-surfaced mutations (addItem)", async () => {
    createItem.mockResolvedValue({ ok: false, error: "boom" });
    const qc = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    seedCache(qc);
    const { result } = renderHook(() => useBoardMutations("b1"), {
      wrapper: wrapper(qc),
    });

    const onError = vi.fn();
    act(() => {
      result.current.addItem({ groupId: "g1", name: "x" }, { onError });
    });

    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect(toastError).not.toHaveBeenCalled();
  });
});

describe("useBoardMutations.startTimer", () => {
  beforeEach(() => startTimerFn.mockReset());

  it("upserts all returned entries (stopped + new) into cache on success", async () => {
    const qc = new QueryClient();
    // Seed with a running entry that will be stopped by startTimer
    const runningEntry = makeEntry({
      id: "running-id",
      ended_at: null,
      duration_secs: null,
    } as Partial<CacheTimeEntry>);
    const cache: BoardCache = {
      board: { id: "b1", org_id: "o1", name: "B" } as never,
      groups: [],
      columns: [],
      relationLinks: [],
      items: [
        { id: "i1", board_id: "b1", group_id: "g1", name: "One" } as never,
      ],
      cellValues: [],
      dependencies: [],
      attachments: [],
      timeEntries: [runningEntry],
      mirrorTargetCells: [],
      mirrorTargetColumns: [],
    };
    qc.setQueryData(boardKey("b1"), cache);

    const stoppedEntry = makeEntry({
      id: "running-id",
      ended_at: "2026-06-20T14:00:00.000Z",
      duration_secs: 7200,
    });
    const newEntry = makeEntry({
      id: "new-timer-id",
      ended_at: null,
      duration_secs: null,
    } as Partial<CacheTimeEntry>);

    startTimerFn.mockResolvedValue({
      ok: true,
      data: { entries: [stoppedEntry, newEntry] },
    });

    const { result } = renderHook(() => useBoardMutations("b1"), {
      wrapper: wrapper(qc),
    });

    await act(async () => {
      result.current.startTimer("i1", "col1");
    });

    await waitFor(() => {
      const updated = qc.getQueryData<BoardCache>(boardKey("b1"))!;
      const ids = updated.timeEntries.map((t) => t.id);
      expect(ids).toContain("running-id");
      expect(ids).toContain("new-timer-id");
      // Stopped entry should have been updated in-place
      const stopped = updated.timeEntries.find((t) => t.id === "running-id");
      expect(stopped?.ended_at).toBe("2026-06-20T14:00:00.000Z");
    });
  });
});

describe("pickFields", () => {
  it("snapshots only the prior values of the changed keys", () => {
    const row = { id: "x", name: "old", position: 3, color: "#000" };
    expect(pickFields(row, { name: "new", position: 9 })).toEqual({
      name: "old",
      position: 3,
    });
  });
});

// ─── Targeted rollback: concurrent-peer preservation ─────────────────────────
// A whole-cache snapshot rollback would resurrect the pre-peer cache and discard
// a collaborator's realtime update that landed while the mutation was failing.
// These tests inject a peer change BETWEEN onMutate and the (failed) settle and
// assert the peer change survives the rollback.

describe("useBoardMutations targeted rollback", () => {
  beforeEach(() => {
    upsertCell.mockReset();
    renameItem.mockReset();
    deleteItem.mockReset();
  });

  function peerCell(itemId: string, text: string): CacheCellValue {
    return {
      item_id: itemId,
      column_id: "c1",
      org_id: "o1",
      board_id: "b1",
      value: { text } as CacheCellValue["value"],
      updated_at: new Date().toISOString(),
    } as CacheCellValue;
  }

  it("keeps a peer's cell edit when a failed setCell rolls back (not whole-snapshot)", async () => {
    const qc = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    seedCache(qc); // cellValues: []

    let settle: (v: { ok: boolean; error?: string }) => void = () => {};
    upsertCell.mockImplementation(() => new Promise((res) => (settle = res)));

    const { result } = renderHook(() => useBoardMutations("b1"), {
      wrapper: wrapper(qc),
    });

    // Fire my mutation; onMutate applies my optimistic (i1,c1) value.
    await act(async () => {
      result.current.setCell({
        itemId: "i1",
        columnId: "c1",
        value: { text: "mine" },
      });
    });
    expect(
      qc
        .getQueryData<BoardCache>(boardKey("b1"))!
        .cellValues.find((c) => c.item_id === "i1"),
    ).toBeDefined();

    // A peer's realtime update lands on a DIFFERENT cell while I'm in flight.
    act(() => {
      const cur = qc.getQueryData<BoardCache>(boardKey("b1"))!;
      qc.setQueryData(
        boardKey("b1"),
        upsertCellValue(cur, peerCell("i2", "peer")),
      );
    });

    // My action now fails → targeted rollback removes only MY (i1,c1).
    await act(async () => {
      settle({ ok: false, error: "boom" });
    });

    await waitFor(() => {
      const cache = qc.getQueryData<BoardCache>(boardKey("b1"))!;
      // my optimistic value reverted…
      expect(cache.cellValues.find((c) => c.item_id === "i1")).toBeUndefined();
      // …but the peer's concurrent change survives.
      const peer = cache.cellValues.find((c) => c.item_id === "i2");
      expect((peer?.value as { text: string }).text).toBe("peer");
    });
  });

  it("keeps a peer's rename of another item when a failed renameItem rolls back", async () => {
    const qc = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    qc.setQueryData(boardKey("b1"), {
      board: { id: "b1", org_id: "o1", name: "B" },
      groups: [],
      columns: [],
      items: [
        { id: "i1", board_id: "b1", group_id: "g1", name: "One" },
        { id: "i2", board_id: "b1", group_id: "g1", name: "Two" },
      ],
      cellValues: [],
      dependencies: [],
      attachments: [],
      timeEntries: [],
      relationLinks: [],
      mirrorTargetCells: [],
      mirrorTargetColumns: [],
    } as never);

    let settle: (v: { ok: boolean; error?: string }) => void = () => {};
    renameItem.mockImplementation(() => new Promise((res) => (settle = res)));

    const { result } = renderHook(() => useBoardMutations("b1"), {
      wrapper: wrapper(qc),
    });

    await act(async () => {
      result.current.renameItem({ itemId: "i1", name: "One!" });
    });

    // Peer renames a DIFFERENT item mid-flight.
    act(() => {
      const cur = qc.getQueryData<BoardCache>(boardKey("b1"))!;
      qc.setQueryData(boardKey("b1"), {
        ...cur,
        items: cur.items.map((i) =>
          i.id === "i2" ? { ...i, name: "Two (peer)" } : i,
        ),
      });
    });

    await act(async () => {
      settle({ ok: false, error: "boom" });
    });

    await waitFor(() => {
      const cache = qc.getQueryData<BoardCache>(boardKey("b1"))!;
      // my rename reverted to the prior name…
      expect(cache.items.find((i) => i.id === "i1")!.name).toBe("One");
      // …peer's concurrent rename of i2 survives.
      expect(cache.items.find((i) => i.id === "i2")!.name).toBe("Two (peer)");
    });
  });

  it("resyncs from the server (invalidateQueries) when a cascade delete fails", async () => {
    const qc = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    seedCache(qc);
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    deleteItem.mockResolvedValue({ ok: false, error: "boom" });

    const { result } = renderHook(() => useBoardMutations("b1"), {
      wrapper: wrapper(qc),
    });

    await act(async () => {
      result.current.deleteItem("i1");
    });

    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: boardKey("b1") }),
    );
  });
});
