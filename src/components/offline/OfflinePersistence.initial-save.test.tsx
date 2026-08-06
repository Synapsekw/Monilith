/**
 * Regression test for the defect that made offline reading fail end-to-end.
 *
 * `persistQueryClientSubscribe` does NOT perform an initial save — read its
 * implementation in `@tanstack/query-persist-client-core`'s `persist.ts`: it
 * subscribes to the query and mutation caches and calls `persistQueryClientSave`
 * only from a SUBSEQUENT `added`/`removed`/`updated` event.
 *
 * `useBoardSnapshot` writes the board snapshot exactly once (its effect is keyed
 * on the board id and view id), and `OfflinePersistence` subscribes only inside
 * `enforceOfflineGrace(...).then(...)` — at least a microtask after that write.
 * So the one event that mattered had already been emitted, no further event
 * followed, and nothing was ever written to disk. Measured against a production
 * build: the `keyval-store` IndexedDB database did not exist at any point while
 * online, and `/offline` therefore reported a just-visited board as never
 * visited.
 *
 * Unlike the sibling suite, this file does NOT mock
 * `@tanstack/react-query-persist-client` — mocking it would only prove we call a
 * function. Only the PERSISTER is faked (jsdom has no IndexedDB), so the real
 * subscribe/save/dehydrate path runs and the assertion is about data actually
 * reaching the persister.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { PersistedClient } from "@tanstack/react-query-persist-client";

const persisted: PersistedClient[] = [];

vi.mock("@/lib/offline/persister", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/offline/persister")
  >("@/lib/offline/persister");
  return {
    ...actual,
    // Same shape as the real `persistOptionsFor`, including the REAL allowlist
    // predicate, so the dehydrate filter is exercised rather than bypassed.
    persistOptionsFor: () => ({
      persister: {
        persistClient: (client: PersistedClient) => {
          persisted.push(client);
          return Promise.resolve();
        },
        restoreClient: () => Promise.resolve(undefined),
        removeClient: () => Promise.resolve(),
      },
      maxAge: 7 * 24 * 60 * 60 * 1000,
      dehydrateOptions: {
        shouldDehydrateQuery: (query: {
          state: { status: string };
          queryKey: readonly unknown[];
        }) =>
          query.state.status === "success" &&
          actual.isPersistableKey(query.queryKey),
      },
    }),
  };
});

vi.mock("@/lib/offline/entitlement", () => ({
  enforceOfflineGrace: () => Promise.resolve(true),
  rememberIdentity: () => undefined,
}));

import { OfflinePersistence } from "./OfflinePersistence";
import { boardSnapshotKey } from "@/lib/offline/snapshot";

function wrap(qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

describe("OfflinePersistence initial save", () => {
  beforeEach(() => {
    persisted.length = 0;
  });

  it("persists a snapshot that was already in the cache before it subscribed", async () => {
    const qc = new QueryClient();
    // The real ordering: BoardViews' `useBoardSnapshot` effect has already run
    // by the time the grace check resolves and the subscription is created.
    qc.setQueryData(boardSnapshotKey("b1"), {
      payload: { board: { id: "b1", org_id: "o1" }, views: [{ id: "v1" }] },
      members: [],
      initialViewId: "v1",
      currentUserId: "u1",
      savedAt: 1,
    });

    render(<OfflinePersistence userId="u1" />, { wrapper: wrap(qc) });

    await waitFor(() => expect(persisted.length).toBeGreaterThan(0));

    const lastWrite = persisted[persisted.length - 1];
    expect(lastWrite.clientState.queries.map((q) => q.queryKey)).toContainEqual(
      ["boardSnapshot", "b1"],
    );
  });

  it("still persists later snapshot changes through the subscription", async () => {
    const qc = new QueryClient();
    render(<OfflinePersistence userId="u1" />, { wrapper: wrap(qc) });
    await waitFor(() => expect(persisted.length).toBeGreaterThan(0));

    const before = persisted.length;
    qc.setQueryData(boardSnapshotKey("b2"), {
      payload: { board: { id: "b2", org_id: "o1" }, views: [{ id: "v9" }] },
      members: [],
      initialViewId: "v9",
      currentUserId: "u1",
      savedAt: 2,
    });

    await waitFor(() => expect(persisted.length).toBeGreaterThan(before));
    expect(
      persisted[persisted.length - 1].clientState.queries.map(
        (q) => q.queryKey,
      ),
    ).toContainEqual(["boardSnapshot", "b2"]);
  });
});
