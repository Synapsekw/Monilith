import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const upsertCell = vi.fn();
const clearCell = vi.fn();
const createGroup = vi.fn();
vi.mock("@/lib/boards/actions", () => ({
  upsertCell: (...a: unknown[]) => upsertCell(...a),
  clearCell: (...a: unknown[]) => clearCell(...a),
  createGroup: (...a: unknown[]) => createGroup(...a),
}));

const createDependency = vi.fn();
const deleteDependency = vi.fn();
vi.mock("@/lib/boards/dependency-actions", () => ({
  createDependency: (...a: unknown[]) => createDependency(...a),
  deleteDependency: (...a: unknown[]) => deleteDependency(...a),
}));

import { useBoardMutations } from "./use-board-mutations";
import { boardKey } from "./use-board-cache";
import type { BoardCache, CacheDependency } from "./cache";

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
