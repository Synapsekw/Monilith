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
 * Upper bound on how many boards one user's offline record may hold. Without a
 * cap, merging (below) would let the record grow with every board ever opened
 * inside the offline window — an unbounded blob rewritten in full on every
 * save. 20 boards is far more than anyone reads offline and keeps the write
 * cheap.
 */
export const MAX_CACHED_BOARDS = 20;

/** One dehydrated query as `dehydrate()` emits it (queryKey/queryHash/state). */
type PersistedQuery = PersistedClient["clientState"]["queries"][number];

/**
 * A snapshot's own age marker. `BoardSnapshot.savedAt` (see snapshot.ts) is
 * stamped when the board is cached; it is the only per-board clock we have,
 * because `PersistedClient.timestamp` is per-RECORD and would be refreshed by
 * every save, keeping a board alive forever just because a different board was
 * viewed. A missing or non-numeric marker means we cannot age the entry out at
 * all, so it is dropped rather than kept forever.
 */
function savedAtOf(query: PersistedQuery): number | null {
  const data: unknown = query.state.data;
  if (typeof data !== "object" || data === null) return null;
  const savedAt = (data as { savedAt?: unknown }).savedAt;
  return typeof savedAt === "number" && Number.isFinite(savedAt)
    ? savedAt
    : null;
}

/**
 * Union the boards already on disk into the outgoing record.
 *
 * Why this exists: `persistQueryClientSave` dehydrates the CURRENT QueryClient
 * and hands us a COMPLETE record. A full page load starts a fresh QueryClient
 * holding only the board being loaded, so a plain `set(key, client)` replaced a
 * multi-board record with a single-board one — every other cached board was
 * destroyed by the first save after any reload, and those boards then reported
 * "isn't available offline" despite having been opened online.
 *
 * The rules, in order:
 *  1. The incoming client wins on `queryHash` collision — it is fresher.
 *  2. Only allowlisted (`boardSnapshot`) keys are carried over, so a rogue
 *     entry that somehow reached disk cannot be re-persisted forever.
 *  3. Carried-over entries past `OFFLINE_WINDOW_MS` (by their own `savedAt`)
 *     are dropped — the record-level `maxAge` only busts the whole cache at
 *     once and would otherwise let a stale board ride along indefinitely.
 *  4. The result is capped at `MAX_CACHED_BOARDS`, newest `savedAt` first.
 *
 * `timestamp`/`buster`/`mutations` come from the incoming record untouched:
 * the restore path compares `timestamp` against `maxAge`, so it must stay the
 * freshest of the two.
 */
export function mergePersistedClients(
  existing: PersistedClient | undefined,
  incoming: PersistedClient,
  now: number = Date.now(),
): PersistedClient {
  const incomingQueries = incoming.clientState.queries;
  const previous: unknown = existing?.clientState?.queries;
  if (!Array.isArray(previous) || previous.length === 0) return incoming;

  const seen = new Set(incomingQueries.map((q) => q.queryHash));
  const room = Math.max(0, MAX_CACHED_BOARDS - incomingQueries.length);

  const carried = (previous as PersistedQuery[])
    .filter(
      (q) =>
        Array.isArray(q?.queryKey) &&
        isPersistableKey(q.queryKey) &&
        !seen.has(q.queryHash),
    )
    .map((query) => ({ query, savedAt: savedAtOf(query) }))
    .filter(
      (entry): entry is { query: PersistedQuery; savedAt: number } =>
        entry.savedAt !== null && now - entry.savedAt < OFFLINE_WINDOW_MS,
    )
    .sort((a, b) => b.savedAt - a.savedAt)
    .slice(0, room)
    .map((entry) => entry.query);

  if (carried.length === 0) return incoming;

  return {
    ...incoming,
    clientState: {
      ...incoming.clientState,
      queries: [...incomingQueries, ...carried],
    },
  };
}

/**
 * Namespaced by user id so signing in as someone else on a shared machine can
 * never restore the previous account's boards. Sign-out wipes it outright
 * (see `wipeOfflineData`); the namespace is the second line of defence.
 */
export function createOfflinePersister(userId: string): Persister {
  const key = offlineIdbKey(userId);
  return {
    persistClient: async (client: PersistedClient) => {
      let merged = client;
      try {
        merged = mergePersistedClients(await get<PersistedClient>(key), client);
      } catch {
        // A failed read (or a record too malformed to merge) must never cost us
        // the write — losing the outgoing board is strictly worse than losing
        // the boards we could not read back.
        merged = client;
      }
      return set(key, merged);
    },
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
