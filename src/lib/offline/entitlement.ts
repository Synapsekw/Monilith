"use client";

import { ENTITLEMENT_KEY, LAST_USER_KEY, OFFLINE_WINDOW_MS } from "./constants";
import { wipeOfflineData } from "./wipe";

/**
 * Shape E6 (billing) must expose so the app can be used offline. Persisted
 * verbatim; `checkedAt` is when we last confirmed it with the server.
 */
export type CachedEntitlement = {
  plan: string;
  status: string;
  checkedAt: number;
};

/**
 * Offline access is honoured for `OFFLINE_WINDOW_MS` past the last successful
 * check — the same window as the cache `maxAge`, so a snapshot never outlives
 * the entitlement that justified keeping it.
 */
export function isWithinGrace(
  entitlement: CachedEntitlement | null,
  now: number,
): boolean {
  if (!entitlement) return false;
  if (entitlement.status !== "active") return false;
  return now - entitlement.checkedAt <= OFFLINE_WINDOW_MS;
}

export function rememberIdentity(userId: string): void {
  window.localStorage.setItem(LAST_USER_KEY, userId);
}

export function readEntitlement(): CachedEntitlement | null {
  try {
    const raw = window.localStorage.getItem(ENTITLEMENT_KEY);
    return raw ? (JSON.parse(raw) as CachedEntitlement) : null;
  } catch {
    return null;
  }
}

export function writeEntitlement(entitlement: CachedEntitlement): void {
  window.localStorage.setItem(ENTITLEMENT_KEY, JSON.stringify(entitlement));
}

/**
 * Wipe everything if the cached entitlement has aged out of its grace window.
 * Returns whether offline use is still permitted.
 *
 * Until E6 lands there is no entitlement to write, so `readEntitlement()`
 * returns null and this is a no-op that permits offline use — the gate is wired
 * and tested, waiting only for a producer. That is deliberate: retro-fitting the
 * gate after billing ships is how it gets forgotten.
 */
export async function enforceOfflineGrace(now: number): Promise<boolean> {
  const entitlement = readEntitlement();
  if (!entitlement) return true;
  if (isWithinGrace(entitlement, now)) return true;
  await wipeOfflineData();
  return false;
}
