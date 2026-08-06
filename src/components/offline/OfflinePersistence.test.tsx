import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";

const unsubscribe = vi.fn();
const persistQueryClientSubscribe = vi.fn((..._args: unknown[]) => unsubscribe);
vi.mock("@tanstack/react-query-persist-client", () => ({
  persistQueryClientSubscribe: (...args: unknown[]) =>
    persistQueryClientSubscribe(...args),
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

function wrap(qc: QueryClient) {
  // Named function expression so eslint's react/display-name has a name to
  // infer — same idiom as `Wrapper` in OfflineBoard.test.tsx.
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

describe("OfflinePersistence", () => {
  beforeEach(() => {
    persistQueryClientSubscribe.mockClear();
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
});
