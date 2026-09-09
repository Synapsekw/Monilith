/**
 * Regression coverage for the write-amplification defect in task 4b.
 *
 * `persistQueryClientSubscribe` (the library helper `OfflinePersistence` used
 * to call) saves on EVERY query- and mutation-cache event: every optimistic
 * cell edit, every realtime rAF flush. But `shouldDehydrateQuery` in
 * `persistOptionsFor` only ever admits `boardSnapshot` queries into the
 * dehydrated payload, and `useBoardSnapshot` writes that query exactly once
 * per board/view — so every other event triggered a `persistClient` call (an
 * IndexedDB read of the whole multi-board record, a structured clone, a
 * merge and a write — see `persister.ts`) that produced byte-identical
 * output. On a large board that is an IDB round trip per second of typing,
 * for nothing.
 *
 * This suite proves the fix at the integration level: it does NOT mock
 * `@tanstack/react-query-persist-client`, so the real `persistQueryClientSave`
 * / `dehydrate` path runs, same as `OfflinePersistence.initial-save.test.tsx`.
 * Only the persister itself is faked (jsdom has no IndexedDB), and every call
 * to it is recorded so the test can assert on COUNT, not just presence.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { PersistedClient } from "@tanstack/react-query-persist-client";

const persistCalls: PersistedClient[] = [];

vi.mock("@/lib/offline/persister", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/offline/persister")
  >("@/lib/offline/persister");
  return {
    ...actual,
    // Same shape as the real `persistOptionsFor`, including the REAL
    // allowlist predicate, so the dehydrate filter is exercised rather than
    // bypassed.
    persistOptionsFor: () => ({
      persister: {
        persistClient: (client: PersistedClient) => {
          persistCalls.push(client);
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

describe("OfflinePersistence write filtering", () => {
  it("does not persist on a non-boardSnapshot (e.g. cell-value) cache update", async () => {
    const qc = new QueryClient();
    render(<OfflinePersistence userId="u1" />, { wrapper: wrap(qc) });

    // The explicit first save (always fires once the grace check resolves).
    await waitFor(() => expect(persistCalls.length).toBe(1));
    const countAfterInitialSave = persistCalls.length;

    // A representative non-boardSnapshot cache write — the kind an
    // optimistic cell edit or a realtime rAF flush produces. This key is not
    // on the persister's allowlist (`isPersistableKey`), so it must not
    // trigger a write at all, byte-identical or otherwise.
    qc.setQueryData(["boardCells", "b1", "item1"], { value: "edited" });
    qc.setQueryData(["boardCells", "b1", "item1"], { value: "edited again" });

    // Give any (incorrect) subscription a turn to fire before asserting its
    // absence.
    await Promise.resolve();
    await Promise.resolve();
    expect(persistCalls.length).toBe(countAfterInitialSave);
  });

  it("persists when a boardSnapshot query is added or updated", async () => {
    const qc = new QueryClient();
    render(<OfflinePersistence userId="u1" />, { wrapper: wrap(qc) });

    await waitFor(() => expect(persistCalls.length).toBe(1));
    const countAfterInitialSave = persistCalls.length;

    qc.setQueryData(boardSnapshotKey("b1"), {
      payload: { board: { id: "b1", org_id: "o1" }, views: [{ id: "v1" }] },
      members: [],
      initialViewId: "v1",
      currentUserId: "u1",
      savedAt: 1,
    });

    await waitFor(() =>
      expect(persistCalls.length).toBeGreaterThan(countAfterInitialSave),
    );
    const lastWrite = persistCalls[persistCalls.length - 1];
    expect(lastWrite.clientState.queries.map((q) => q.queryKey)).toContainEqual(
      ["boardSnapshot", "b1"],
    );
  });
});
