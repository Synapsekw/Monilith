"use client";

import { clear } from "idb-keyval";
import { ENTITLEMENT_KEY, LAST_USER_KEY } from "./constants";

/**
 * Remove every trace of offline data. Called on sign-out BEFORE the server
 * action redirects, and whenever a stale session is detected at boot.
 *
 * The localStorage identity markers are cleared FIRST, before IndexedDB or the
 * Cache API — this ordering is deliberate, not incidental. The `/offline`
 * route keys its decision to render a previous user's cached boards off
 * `LAST_USER_KEY`. If the IndexedDB clear below fails silently (a blocked
 * transaction, a private-browsing restriction), clearing the marker first
 * still leaves the route with nothing to act on for the next person on this
 * machine. That is defence in depth: do not reorder this into "tidier" code
 * that clears IndexedDB before the markers.
 *
 * Clears the whole idb-keyval store rather than one namespaced key: at
 * sign-out we want any other account's leftovers gone too, and this store holds
 * nothing but offline snapshots. Service-worker caches go with it, otherwise
 * the precached `/offline` document would still be served to the next user.
 *
 * Failures are collected, not swallowed — but a user who cannot sign out is a
 * worse outcome than a wipe that missed a step, so this always resolves. When
 * any step failed, it logs one `console.error` naming what did not get
 * cleared so the failure is visible instead of silently reporting success.
 */
export async function wipeOfflineData(): Promise<void> {
  const failures: string[] = [];

  try {
    localStorage.removeItem(LAST_USER_KEY);
    localStorage.removeItem(ENTITLEMENT_KEY);
  } catch {
    failures.push("localStorage identity markers");
  }

  await clear().catch(() => {
    failures.push("IndexedDB store");
  });

  if (typeof caches !== "undefined") {
    const keys = await caches.keys().catch(() => {
      failures.push("Cache API (listing caches)");
      return [] as string[];
    });
    await Promise.all(
      keys.map((k) =>
        caches.delete(k).catch(() => {
          failures.push(`Cache API entry "${k}"`);
          return false;
        }),
      ),
    );
  }

  if (failures.length > 0) {
    console.error(`wipeOfflineData: failed to clear: ${failures.join(", ")}`);
  }
}
