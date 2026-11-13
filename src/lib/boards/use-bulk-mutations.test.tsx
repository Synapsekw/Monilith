import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const bulkSetCellAction = vi.fn();
vi.mock("@/lib/boards/bulk-actions", () => ({
  bulkArchiveItems: vi.fn(),
  bulkRestoreItems: vi.fn(),
  bulkMoveItems: vi.fn(),
  bulkSetCell: (...a: unknown[]) => bulkSetCellAction(...a),
}));
const toastError = vi.fn();
vi.mock("sonner", () => {
  const toast = (..._a: unknown[]) => undefined;
  toast.error = (...a: unknown[]) => toastError(...a);
  return { toast };
});

import { useBulkMutations } from "./use-bulk-mutations";
import { boardKey } from "./use-board-cache";
import type { BoardCache } from "./cache";
import { boardMembershipKey, useMyMonoStore } from "@/stores/my-mono";

function seed(qc: QueryClient) {
  qc.setQueryData<BoardCache>(boardKey("b1"), {
    board: { id: "b1", org_id: "o1", name: "B" } as never,
    groups: [],
    columns: [],
    items: [],
    cellValues: [
      {
        item_id: "i2",
        column_id: "c1",
        value: { userIds: ["m1"] } as never,
        updated_at: "t",
      },
    ],
    dependencies: [],
    attachments: [],
    timeEntries: [],
    relationLinks: [],
    mirrorTargetCells: [],
    mirrorTargetColumns: [],
  });
}

function wrapper(qc: QueryClient) {
  const W = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  W.displayName = "TestWrapper";
  return W;
}

beforeEach(() => {
  bulkSetCellAction.mockReset();
  toastError.mockReset();
  useMyMonoStore.setState({ membership: {}, ownMonoId: "m1" });
});

describe("useBulkMutations.bulkSetCell", () => {
  it("marks the viewer's own Mono on this board when a bulk assign adds it", async () => {
    const qc = new QueryClient();
    seed(qc);
    bulkSetCellAction.mockResolvedValue({
      ok: true,
      data: { succeeded: ["i1"], failed: [] },
    });
    const { result } = renderHook(() => useBulkMutations("b1"), {
      wrapper: wrapper(qc),
    });
    act(() => {
      result.current.bulkSetCell(["i1"], "c1", { userIds: ["m1"] });
    });
    await waitFor(() =>
      expect(
        useMyMonoStore.getState().membership[boardMembershipKey("m1", "b1")],
      ).toBe(true),
    );
  });

  it("does not mark it when every write that would add it failed", async () => {
    const qc = new QueryClient();
    seed(qc);
    // i2 already had the Mono; i1 (the only newly-adding write) failed.
    bulkSetCellAction.mockResolvedValue({
      ok: true,
      data: { succeeded: ["i2"], failed: [{ itemId: "i1", error: "x" }] },
    });
    const { result } = renderHook(() => useBulkMutations("b1"), {
      wrapper: wrapper(qc),
    });
    act(() => {
      result.current.bulkSetCell(["i1", "i2"], "c1", { userIds: ["m1"] });
    });
    // The partial-failure toast fires from the same onSuccess, after the note.
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(useMyMonoStore.getState().membership).toEqual({});
  });
});
