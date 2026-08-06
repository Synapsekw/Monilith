"use client";

import type { Query } from "@tanstack/react-query";
import type {
  PersistedClient,
  Persister,
} from "@tanstack/react-query-persist-client";
import { del, get, set } from "idb-keyval";
import { OFFLINE_WINDOW_MS } from "./constants";

/**
 * The ONLY query keys written to disk. Offline is scoped to reading boards, so
 * nothing else earns a copy in unencrypted local storage. Adding a prefix here
 * is a deliberate act with a privacy consequence — see the plan's Global
 * Constraints before extending it.
 */
export const PERSISTED_KEY_PREFIXES = ["boardSnapshot"] as const;

/** Base IndexedDB key; the real key is suffixed with the user id. */
const IDB_KEY_BASE = "monolith-offline";

export function offlineIdbKey(userId: string): string {
  return `${IDB_KEY_BASE}:${userId}`;
}

export function isPersistableKey(key: readonly unknown[]): boolean {
  const head = key[0];
  return (
    typeof head === "string" &&
    (PERSISTED_KEY_PREFIXES as readonly string[]).includes(head)
  );
}

/**
 * Namespaced by user id so signing in as someone else on a shared machine can
 * never restore the previous account's boards. Sign-out wipes it outright
 * (see `wipeOfflineData`); the namespace is the second line of defence.
 */
export function createOfflinePersister(userId: string): Persister {
  const key = offlineIdbKey(userId);
  return {
    persistClient: (client: PersistedClient) => set(key, client),
    restoreClient: () => get<PersistedClient>(key),
    removeClient: () => del(key),
  };
}

export function persistOptionsFor(userId: string) {
  return {
    persister: createOfflinePersister(userId),
    maxAge: OFFLINE_WINDOW_MS,
    dehydrateOptions: {
      shouldDehydrateQuery: (query: Query) =>
        query.state.status === "success" && isPersistableKey(query.queryKey),
    },
  };
}
