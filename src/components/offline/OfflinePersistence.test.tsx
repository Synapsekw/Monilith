import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";

const unsubscribe = vi.fn();
const persistQueryClientSubscribe = vi.fn((..._args: unknown[]) => unsubscribe);
// `persistQueryClientSave` must be part of this mock, not omitted: the
// component calls it for the initial save (the subscription alone never
// captures state that predates it — see OfflinePersistence.initial-save.test.tsx).
// Omitting it here does not fail a test, it throws an UNHANDLED error while the
// suite still reports green, which is precisely the failure mode this branch
// has been bitten by before.
const persistQueryClientSave = vi.fn((..._args: unknown[]) =>
  Promise.resolve(),
);
vi.mock("@tanstack/react-query-persist-client", () => ({
  persistQueryClientSubscribe: (...args: unknown[]) =>
    persistQueryClientSubscribe(...args),
  persistQueryClientSave: (...args: unknown[]) =>
    persistQueryClientSave(...args),
}));

const enforceOfflineGrace = vi.fn();
const rememberIdentity = vi.fn();
vi.mock("@/lib/offline/entitlement", () => ({
  enforceOfflineGrace: (...args: unknown[]) => enforceOfflineGrace(...args),
  rememberIdentity: (...args: unknown[]) => rememberIdentity(...args),
}));

vi.mock("@/lib/offline/persister", () => ({
  persistOptionsFor: () => ({ persister: {}, maxAge: 0 }),
}));

import { OfflinePersistence } from "./OfflinePersistence";
import { OfflineRenderProvider } from "@/lib/offline/offline-render-context";

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
    persistQueryClientSubscribe.mockClear();
    persistQueryClientSave.mockClear();
    unsubscribe.mockClear();
    enforceOfflineGrace.mockReset();
    rememberIdentity.mockReset();
  });

  it("subscribes once the grace check permits offline use", async () => {
    enforceOfflineGrace.mockResolvedValue(true);
    const qc = new QueryClient();

    render(<OfflinePersistence userId="u1" />, { wrapper: wrap(qc) });

    await waitFor(() =>
      expect(persistQueryClientSubscribe).toHaveBeenCalledTimes(1),
    );
    expect(rememberIdentity).toHaveBeenCalledWith("u1");
  });

  it("does not subscribe when the grace has lapsed", async () => {
    enforceOfflineGrace.mockResolvedValue(false);
    const qc = new QueryClient();

    render(<OfflinePersistence userId="u1" />, { wrapper: wrap(qc) });

    await waitFor(() => expect(enforceOfflineGrace).toHaveBeenCalledTimes(1));
    // Give any (incorrect) synchronous-subscribe path a turn to run before
    // asserting its absence.
    await Promise.resolve();
    expect(persistQueryClientSubscribe).not.toHaveBeenCalled();
  });

  it("does not subscribe if unmounted before the grace check resolves", async () => {
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

    expect(persistQueryClientSubscribe).not.toHaveBeenCalled();
  });

  it("does not subscribe inside OfflineRenderProvider even when grace permits", async () => {
    // This is the defect: BoardViews (which renders OfflinePersistence) is
    // reused to render the cached board on the `/offline` route. Without this
    // guard, merely viewing a board offline re-persists the whole client to
    // IndexedDB on a device already known to be offline.
    enforceOfflineGrace.mockResolvedValue(true);
    const qc = new QueryClient();

    render(<OfflinePersistence userId="u1" />, { wrapper: wrapOffline(qc) });

    // Give the (incorrect) async subscribe path a turn to run before
    // asserting its absence.
    await Promise.resolve();
    await Promise.resolve();
    expect(enforceOfflineGrace).not.toHaveBeenCalled();
    expect(persistQueryClientSubscribe).not.toHaveBeenCalled();
    expect(rememberIdentity).not.toHaveBeenCalled();
  });

  it("still subscribes normally outside the offline provider when grace permits", async () => {
    enforceOfflineGrace.mockResolvedValue(true);
    const qc = new QueryClient();

    render(<OfflinePersistence userId="u1" />, { wrapper: wrap(qc) });

    await waitFor(() =>
      expect(persistQueryClientSubscribe).toHaveBeenCalledTimes(1),
    );
  });
});
