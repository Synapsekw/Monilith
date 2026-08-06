/**
 * Regression suite for the multi-board offline defect.
 *
 * `persistQueryClientSave` dehydrates the CURRENT QueryClient and hands the
 * persister a COMPLETE record, which the old `persistClient` wrote straight
 * over the top of whatever was already on disk. A full page load starts a fresh
 * QueryClient holding only the board being loaded, so the first save after ANY
 * reload replaced a multi-board record with a single-board one and destroyed
 * every other cached board. Measured against a production build:
 *
 *   PERSISTED after visiting BOTH boards:     [[boardSnapshot, Alpha], [boardSnapshot, Beta]]
 *   PERSISTED after an online reload on Beta: [[boardSnapshot, Beta]]   <-- Alpha gone
 *
 * The fix makes the write a MERGE. These tests pin the merge's four rules
 * (union, incoming-wins, age-out, cap) plus the invariant that a broken read
 * must never cost us the write.
 */

import { get, set } from "idb-keyval";
import type { PersistedClient } from "@tanstack/react-query-persist-client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OFFLINE_WINDOW_MS } from "./constants";
import {
  MAX_CACHED_BOARDS,
  createOfflinePersister,
  offlineIdbKey,
} from "./persister";

// `vi.hoisted` so the store exists before the hoisted `vi.mock` factory runs;
// a plain `const` would be in its TDZ at factory time.
const { store } = vi.hoisted(() => ({ store: new Map<string, unknown>() }));

vi.mock("idb-keyval", () => ({
  get: vi.fn((key: string) => Promise.resolve(store.get(key))),
  set: vi.fn((key: string, value: unknown) => {
    store.set(key, value);
    return Promise.resolve();
  }),
  del: vi.fn((key: string) => {
    store.delete(key);
    return Promise.resolve();
  }),
}));

type PersistedQueryEntry = PersistedClient["clientState"]["queries"][number];

/** A dehydrated `boardSnapshot` query, shaped exactly as `dehydrate()` emits. */
function snapshotQuery(boardId: string, savedAt: unknown): PersistedQueryEntry {
  return {
    queryKey: ["boardSnapshot", boardId],
    queryHash: JSON.stringify(["boardSnapshot", boardId]),
    state: {
      data: { boardId, savedAt },
      dataUpdateCount: 1,
      dataUpdatedAt: 0,
      error: null,
      errorUpdateCount: 0,
      errorUpdatedAt: 0,
      fetchFailureCount: 0,
      fetchFailureReason: null,
      fetchMeta: null,
      isInvalidated: false,
      status: "success",
      fetchStatus: "idle",
    },
  };
}

function clientWith(queries: PersistedQueryEntry[]): PersistedClient {
  return {
    timestamp: Date.now(),
    buster: "",
    clientState: { mutations: [], queries },
  };
}

/** The board ids in whatever was last written to the fake IndexedDB. */
function persistedBoardIds(userId: string): string[] {
  const record = store.get(offlineIdbKey(userId)) as
    | PersistedClient
    | undefined;
  return (record?.clientState.queries ?? []).map((q) => String(q.queryKey[1]));
}

const NOW = 1_700_000_000_000;

describe("createOfflinePersister — merging writes", () => {
  beforeEach(() => {
    store.clear();
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  it("keeps a previously persisted OTHER board when a fresh client holds only one", async () => {
    const persister = createOfflinePersister("u1");

    // Session 1: both boards were open, so both got persisted.
    await persister.persistClient(
      clientWith([
        snapshotQuery("alpha", NOW - 1000),
        snapshotQuery("beta", NOW - 500),
      ]),
    );

    // Session 2 — a full reload on Beta. The fresh QueryClient knows nothing
    // about Alpha; before the fix this write erased it.
    await persister.persistClient(clientWith([snapshotQuery("beta", NOW)]));

    expect(persistedBoardIds("u1").sort()).toEqual(["alpha", "beta"]);
  });

  it("lets the incoming client win for a board present in both", async () => {
    const persister = createOfflinePersister("u1");

    await persister.persistClient(clientWith([snapshotQuery("alpha", 1)]));
    await persister.persistClient(clientWith([snapshotQuery("alpha", 2)]));

    const record = store.get(offlineIdbKey("u1")) as PersistedClient;
    const alpha = record.clientState.queries.filter(
      (q) => q.queryKey[1] === "alpha",
    );
    // Deduped by queryHash — one entry, and it is the fresher one.
    expect(alpha).toHaveLength(1);
    expect((alpha[0].state.data as { savedAt: number }).savedAt).toBe(2);
  });

  it("drops a carried-over board older than OFFLINE_WINDOW_MS", async () => {
    const persister = createOfflinePersister("u1");

    await persister.persistClient(
      clientWith([
        snapshotQuery("stale", NOW - OFFLINE_WINDOW_MS - 1),
        snapshotQuery("fresh", NOW - 1000),
      ]),
    );
    await persister.persistClient(clientWith([snapshotQuery("current", NOW)]));

    expect(persistedBoardIds("u1").sort()).toEqual(["current", "fresh"]);
  });

  it("drops a carried-over board whose savedAt is missing or not a number", async () => {
    const persister = createOfflinePersister("u1");

    await persister.persistClient(
      clientWith([
        snapshotQuery("no-saved-at", undefined),
        snapshotQuery("string-saved-at", "yesterday"),
        snapshotQuery("good", NOW - 1000),
      ]),
    );
    await persister.persistClient(clientWith([snapshotQuery("current", NOW)]));

    expect(persistedBoardIds("u1").sort()).toEqual(["current", "good"]);
  });

  it("caps the record at MAX_CACHED_BOARDS, keeping the newest by savedAt", async () => {
    const persister = createOfflinePersister("u1");

    // MAX_CACHED_BOARDS + 5 previously cached boards, oldest first: board-0 is
    // the oldest, board-N the newest.
    const total = MAX_CACHED_BOARDS + 5;
    await persister.persistClient(
      clientWith(
        Array.from({ length: total }, (_, i) =>
          snapshotQuery(`board-${i}`, NOW - (total - i) * 1000),
        ),
      ),
    );
    await persister.persistClient(clientWith([snapshotQuery("current", NOW)]));

    const ids = persistedBoardIds("u1");
    expect(ids).toHaveLength(MAX_CACHED_BOARDS);
    expect(ids).toContain("current");
    // The newest carried-over survivor is kept, the oldest is evicted.
    expect(ids).toContain(`board-${total - 1}`);
    expect(ids).not.toContain("board-0");
  });

  it("still writes the outgoing client when reading the existing record throws", async () => {
    const persister = createOfflinePersister("u1");
    vi.mocked(get).mockRejectedValueOnce(new Error("IndexedDB unavailable"));

    const outgoing = clientWith([snapshotQuery("beta", NOW)]);
    await expect(persister.persistClient(outgoing)).resolves.toBeUndefined();

    expect(set).toHaveBeenCalledWith(offlineIdbKey("u1"), outgoing);
    expect(persistedBoardIds("u1")).toEqual(["beta"]);
  });

  it("ignores a malformed existing record rather than losing the write", async () => {
    const persister = createOfflinePersister("u1");
    store.set(offlineIdbKey("u1"), { nonsense: true });

    await persister.persistClient(clientWith([snapshotQuery("beta", NOW)]));

    expect(persistedBoardIds("u1")).toEqual(["beta"]);
  });

  it("never carries over a non-allowlisted query that somehow reached disk", async () => {
    const persister = createOfflinePersister("u1");
    const rogue: PersistedQueryEntry = {
      ...snapshotQuery("x", NOW),
      queryKey: ["notifications", "u1"],
      queryHash: JSON.stringify(["notifications", "u1"]),
    };
    store.set(offlineIdbKey("u1"), clientWith([rogue]));

    await persister.persistClient(clientWith([snapshotQuery("beta", NOW)]));

    const record = store.get(offlineIdbKey("u1")) as PersistedClient;
    expect(record.clientState.queries.map((q) => q.queryKey)).toEqual([
      ["boardSnapshot", "beta"],
    ]);
  });
});
