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
vi.mock("@/lib/boards/actions", () => ({
  upsertCell: (...a: unknown[]) => upsertCell(...a),
  clearCell: (...a: unknown[]) => clearCell(...a),
  createGroup: (...a: unknown[]) => createGroup(...a),
  reorderGroup: (...a: unknown[]) => reorderGroup(...a),
  updateGroupColor: (...a: unknown[]) => updateGroupColor(...a),
  deleteGroup: (...a: unknown[]) => deleteGroup(...a),
  createColumn: (...a: unknown[]) => createColumn(...a),
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

import { useBoardMutations, stripOption } from "./use-board-mutations";
import { boardKey } from "./use-board-cache";
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

  it("rolls back when the action fails", async () => {
    const qc = new QueryClient();
    seedGroups(qc);
    deleteGroup.mockResolvedValue({ ok: false, error: "boom" });
    const { result } = renderHook(() => useBoardMutations("b1"), {
      wrapper: wrapper(qc),
    });

    await act(async () => {
      result.current.deleteGroup("g1");
    });

    await waitFor(() => {
      const cache = qc.getQueryData<BoardCache>(boardKey("b1"))!;
      expect(cache.groups.map((g) => g.id)).toEqual(["g1", "g2"]);
      expect(cache.items).toHaveLength(1);
    });
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
