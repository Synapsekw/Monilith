import { del, get, set } from "idb-keyval";
import type { PersistedClient } from "@tanstack/react-query-persist-client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createOfflinePersister,
  isPersistableKey,
  offlineIdbKey,
} from "./persister";

// A minimal fake idb-keyval backed by an in-memory Map, so `createOfflinePersister`
// round-trips can be verified without touching real IndexedDB (not available in jsdom).
vi.mock("idb-keyval", () => {
  const store = new Map<string, unknown>();
  return {
    get: vi.fn((key: string) => Promise.resolve(store.get(key))),
    set: vi.fn((key: string, value: unknown) => {
      store.set(key, value);
      return Promise.resolve();
    }),
    del: vi.fn((key: string) => {
      store.delete(key);
      return Promise.resolve();
    }),
  };
});

function fakeClient(marker: string): PersistedClient {
  return {
    timestamp: Date.now(),
    buster: marker,
    clientState: { mutations: [], queries: [] },
  };
}

describe("isPersistableKey", () => {
  it("persists the board snapshot", () => {
    expect(isPersistableKey(["boardSnapshot", "abc"])).toBe(true);
  });

  it("refuses everything not on the allowlist", () => {
    // Persisting these would write AI conversation text, widget aggregations
    // and notification bodies to disk for a capability that only needs boards.
    expect(isPersistableKey(["board", "abc"])).toBe(false);
    expect(isPersistableKey(["notifications", "u1"])).toBe(false);
    expect(isPersistableKey(["agent-runs", "a1"])).toBe(false);
    expect(isPersistableKey(["widget-data", "w1"])).toBe(false);
  });

  it("refuses a non-string first segment", () => {
    expect(isPersistableKey([42])).toBe(false);
    expect(isPersistableKey([])).toBe(false);
  });
});

describe("createOfflinePersister", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("routes persistClient, restoreClient and removeClient through the same namespaced key", async () => {
    const persister = createOfflinePersister("user-a");
    const client = fakeClient("a");
    const key = offlineIdbKey("user-a");

    await persister.persistClient(client);
    expect(set).toHaveBeenCalledWith(key, client);

    await persister.restoreClient();
    expect(get).toHaveBeenCalledWith(key);

    await persister.removeClient();
    expect(del).toHaveBeenCalledWith(key);
  });

  it("keeps two accounts isolated — a write through one is invisible through the other", async () => {
    const userA = createOfflinePersister("user-a");
    const userB = createOfflinePersister("user-b");
    const clientA = fakeClient("a");

    await userA.persistClient(clientA);

    // The cross-account guarantee this task exists for: signing in as someone
    // else on a shared machine must never restore the previous account's boards.
    await expect(userB.restoreClient()).resolves.toBeUndefined();
    await expect(userA.restoreClient()).resolves.toEqual(clientA);
  });
});
