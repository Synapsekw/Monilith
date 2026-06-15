import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const upsertCell = vi.fn();
const clearCell = vi.fn();
vi.mock("@/lib/boards/actions", () => ({
  upsertCell: (...a: unknown[]) => upsertCell(...a),
  clearCell: (...a: unknown[]) => clearCell(...a),
}));

import { useBoardMutations } from "./use-board-mutations";
import { boardKey } from "./use-board-cache";
import type { BoardCache } from "./cache";

function seedCache(qc: QueryClient): BoardCache {
  const cache: BoardCache = {
    board: { id: "b1", org_id: "o1", name: "B" } as never,
    groups: [],
    columns: [],
    items: [{ id: "i1", board_id: "b1", group_id: "g1", name: "One" } as never],
    cellValues: [],
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
