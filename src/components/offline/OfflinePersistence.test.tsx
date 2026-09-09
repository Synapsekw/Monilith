import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";

// `persistQueryClientSubscribe` is no longer used by the component (task 4b
// replaced it with a direct `queryClient.getQueryCache().subscribe(...)` so
// the write can be filtered to `boardSnapshot` events — see OfflinePersistence.tsx
// and OfflinePersistence.filter.test.tsx for that behavior). Only
// `persistQueryClientSave` needs mocking here.
const persistQueryClientSave = vi.fn((..._args: unknown[]) =>
  Promise.resolve(),
);
vi.mock("@tanstack/react-query-persist-client", () => ({
  persistQueryClientSave: (...args: unknown[]) =>
    persistQueryClientSave(...args),
}));

const enforceOfflineGrace = vi.fn();
const rememberIdentity = vi.fn();
vi.mock("@/lib/offline/entitlement", () => ({
  enforceOfflineGrace: (...args: unknown[]) => enforceOfflineGrace(...args),
  rememberIdentity: (...args: unknown[]) => rememberIdentity(...args),
}));

// `isPersistableKey` must stay the REAL implementation — the component calls
// it directly to filter query-cache events — so only `persistOptionsFor` is
// overridden here.
vi.mock("@/lib/offline/persister", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/offline/persister")
  >("@/lib/offline/persister");
  return {
    ...actual,
    persistOptionsFor: () => ({ persister: {}, maxAge: 0 }),
  };
});

import { OfflinePersistence } from "./OfflinePersistence";
import { OfflineRenderProvider } from "@/lib/offline/offline-render-context";
import { boardSnapshotKey } from "@/lib/offline/snapshot";

function wrap(qc: QueryClient) {
  // Named function expression so eslint's react/display-name has a name to
  // infer — same idiom as `Wrapper` in OfflineBoard.test.tsx.
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

function wrapOffline(qc: QueryClient) {
  return function OfflineWrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={qc}>
        <OfflineRenderProvider>{children}</OfflineRenderProvider>
      </QueryClientProvider>
    );
  };
}

describe("OfflinePersistence", () => {
  beforeEach(() => {
    persistQueryClientSave.mockClear();
    enforceOfflineGrace.mockReset();
    rememberIdentity.mockReset();
  });

  it("performs the explicit first save once the grace check permits offline use", async () => {
    enforceOfflineGrace.mockResolvedValue(true);
    const qc = new QueryClient();

    render(<OfflinePersistence userId="u1" />, { wrapper: wrap(qc) });

    await waitFor(() =>
      expect(persistQueryClientSave).toHaveBeenCalledTimes(1),
    );
    expect(rememberIdentity).toHaveBeenCalledWith("u1");
  });

  it("does not save when the grace has lapsed", async () => {
    enforceOfflineGrace.mockResolvedValue(false);
    const qc = new QueryClient();

    render(<OfflinePersistence userId="u1" />, { wrapper: wrap(qc) });

    await waitFor(() => expect(enforceOfflineGrace).toHaveBeenCalledTimes(1));
    // Give any (incorrect) synchronous-save path a turn to run before
    // asserting its absence.
    await Promise.resolve();
    expect(persistQueryClientSave).not.toHaveBeenCalled();
  });

  it("does not save if unmounted before the grace check resolves", async () => {
    let resolveGrace!: (permitted: boolean) => void;
    enforceOfflineGrace.mockReturnValue(
      new Promise<boolean>((resolve) => {
        resolveGrace = resolve;
      }),
    );
    const qc = new QueryClient();

    const { unmount } = render(<OfflinePersistence userId="u1" />, {
      wrapper: wrap(qc),
    });
    unmount();
    resolveGrace(true);
    await Promise.resolve();

    expect(persistQueryClientSave).not.toHaveBeenCalled();
  });

  it("does not save inside OfflineRenderProvider even when grace permits", async () => {
    // This is the defect: BoardViews (which renders OfflinePersistence) is
    // reused to render the cached board on the `/offline` route. Without this
    // guard, merely viewing a board offline re-persists the whole client to
    // IndexedDB on a device already known to be offline.
    enforceOfflineGrace.mockResolvedValue(true);
    const qc = new QueryClient();

    render(<OfflinePersistence userId="u1" />, { wrapper: wrapOffline(qc) });

    // Give the (incorrect) async save path a turn to run before asserting its
    // absence.
    await Promise.resolve();
    await Promise.resolve();
    expect(enforceOfflineGrace).not.toHaveBeenCalled();
    expect(persistQueryClientSave).not.toHaveBeenCalled();
    expect(rememberIdentity).not.toHaveBeenCalled();
  });

  it("still performs the explicit first save normally outside the offline provider when grace permits", async () => {
    enforceOfflineGrace.mockResolvedValue(true);
    const qc = new QueryClient();

    render(<OfflinePersistence userId="u1" />, { wrapper: wrap(qc) });

    await waitFor(() =>
      expect(persistQueryClientSave).toHaveBeenCalledTimes(1),
    );
  });

  it("keeps saving on later boardSnapshot writes through the subscription", async () => {
    // Proves the replacement subscription (queryClient.getQueryCache().subscribe)
    // is actually live, not just the one-time explicit save.
    enforceOfflineGrace.mockResolvedValue(true);
    const qc = new QueryClient();

    render(<OfflinePersistence userId="u1" />, { wrapper: wrap(qc) });
    await waitFor(() =>
      expect(persistQueryClientSave).toHaveBeenCalledTimes(1),
    );

    qc.setQueryData(boardSnapshotKey("b2"), {
      payload: { board: { id: "b2", org_id: "o1" }, views: [{ id: "v9" }] },
      members: [],
      initialViewId: "v9",
      currentUserId: "u1",
      savedAt: 2,
    });

    await waitFor(() =>
      expect(persistQueryClientSave.mock.calls.length).toBeGreaterThan(1),
    );
  });
});
