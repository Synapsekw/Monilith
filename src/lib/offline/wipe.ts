"use client";

import { clear } from "idb-keyval";

/**
 * Remove every trace of offline data. Called on sign-out BEFORE the server
 * action redirects, and whenever a stale session is detected at boot.
 *
 * Clears the whole idb-keyval store rather than one namespaced key: at
 * sign-out we want any other account's leftovers gone too, and this store holds
 * nothing but offline snapshots. Service-worker caches go with it, otherwise
 * the precached `/offline` document would still be served to the next user.
 */
export async function wipeOfflineData(): Promise<void> {
  await clear().catch(() => undefined);

  if (typeof caches !== "undefined") {
    const keys = await caches.keys().catch(() => [] as string[]);
    await Promise.all(keys.map((k) => caches.delete(k).catch(() => false)));
  }
}
