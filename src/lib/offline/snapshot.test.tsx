import { QueryClient } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { isPersistableKey } from "@/lib/offline/persister";
import { OfflineRenderProvider } from "@/lib/offline/offline-render-context";
import {
  boardSnapshotKey,
  useBoardSnapshot,
  type BoardSnapshot,
} from "./snapshot";

const payload = { board: { id: "b1", org_id: "o1" }, views: [{ id: "v1" }] };

function wrapper(qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

function offlineWrapper(qc: QueryClient) {
  return function OfflineWrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={qc}>
        <OfflineRenderProvider>{children}</OfflineRenderProvider>
      </QueryClientProvider>
    );
  };
}

describe("useBoardSnapshot", () => {
  it("writes the render props under the board snapshot key", () => {
    const qc = new QueryClient();
    renderHook(
      () =>
        useBoardSnapshot({
          payload: payload as never,
          members: [],
          initialViewId: "v1",
          currentUserId: "u1",
        }),
      { wrapper: wrapper(qc) },
    );

    const stored = qc.getQueryData<BoardSnapshot>(boardSnapshotKey("b1"));
    expect(stored?.initialViewId).toBe("v1");
    expect(stored?.currentUserId).toBe("u1");
    expect(stored?.payload.views).toHaveLength(1);
    expect(typeof stored?.savedAt).toBe("number");
  });

  it("does not re-fire the write when boardId and initialViewId are unchanged", () => {
    const qc = new QueryClient();
    const setQueryDataSpy = vi.spyOn(qc, "setQueryData");

    const { rerender } = renderHook(
      (props: Parameters<typeof useBoardSnapshot>[0]) =>
        useBoardSnapshot(props),
      {
        wrapper: wrapper(qc),
        initialProps: {
          payload: payload as never,
          members: [],
          initialViewId: "v1",
          currentUserId: "u1",
        },
      },
    );

    expect(setQueryDataSpy).toHaveBeenCalledTimes(1);
    const firstStored = qc.getQueryData<BoardSnapshot>(boardSnapshotKey("b1"));

    // Re-render with the same boardId/initialViewId but a different payload
    // object and a non-empty members array — neither should trigger a write.
    const changedPayload = {
      ...payload,
      views: [{ id: "v1" }, { id: "v2" }],
    };
    rerender({
      payload: changedPayload as never,
      members: [{ userId: "u2" } as never],
      initialViewId: "v1",
      currentUserId: "u1",
    });

    expect(setQueryDataSpy).toHaveBeenCalledTimes(1);
    const secondStored = qc.getQueryData<BoardSnapshot>(boardSnapshotKey("b1"));
    // Nothing was rewritten — same `savedAt`, and still the original payload
    // (not the changed one from the unfired re-render).
    expect(secondStored?.savedAt).toBe(firstStored?.savedAt);
    expect(secondStored?.payload.views).toHaveLength(1);
  });

  it("fires on initialViewId change and persists the then-current (not stale) snapshot", () => {
    const qc = new QueryClient();

    const { rerender } = renderHook(
      (props: Parameters<typeof useBoardSnapshot>[0]) =>
        useBoardSnapshot(props),
      {
        wrapper: wrapper(qc),
        initialProps: {
          payload: payload as never,
          members: [],
          initialViewId: "v1",
          currentUserId: "u1",
        },
      },
    );

    // Change the payload AND the view together — the write this triggers
    // must reflect the NEW payload, not the one captured on mount. This is
    // the staleness guard on the ref: if the persistence effect ever closed
    // over the mount-time `snapshot` instead of reading `snapshotRef.current`,
    // this would still show the old (1-view) payload.
    const newPayload = {
      board: { id: "b1", org_id: "o1" },
      views: [{ id: "v1" }, { id: "v2" }, { id: "v3" }],
    };
    rerender({
      payload: newPayload as never,
      members: [],
      initialViewId: "v2",
      currentUserId: "u1",
    });

    const stored = qc.getQueryData<BoardSnapshot>(boardSnapshotKey("b1"));
    expect(stored?.initialViewId).toBe("v2");
    expect(stored?.payload.views).toHaveLength(3);
  });

  it("produces a key that satisfies the persister's allowlist", () => {
    expect(isPersistableKey(boardSnapshotKey("b1"))).toBe(true);
  });

  it("does NOT write when rendered inside OfflineRenderProvider", () => {
    // This is the defect: BoardViews (which calls useBoardSnapshot) is reused
    // to render the cached board on the `/offline` route. Without this guard,
    // merely viewing a board offline re-stamps `savedAt` and the 7-day
    // OFFLINE_WINDOW_MS cap never applies.
    const qc = new QueryClient();
    const setQueryDataSpy = vi.spyOn(qc, "setQueryData");

    renderHook(
      () =>
        useBoardSnapshot({
          payload: payload as never,
          members: [],
          initialViewId: "v1",
          currentUserId: "u1",
        }),
      { wrapper: offlineWrapper(qc) },
    );

    expect(setQueryDataSpy).not.toHaveBeenCalled();
    expect(qc.getQueryData(boardSnapshotKey("b1"))).toBeUndefined();
  });
});
