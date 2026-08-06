"use client";

import { onlineManager } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { OFFLINE_MESSAGE } from "./constants";

/**
 * Seed `onlineManager` from `navigator.onLine`, and keep it in sync.
 *
 * TanStack's `OnlineManager` initialises `#online = true` and only ever changes
 * it from the window's `online`/`offline` EVENTS — read its source in
 * `@tanstack/query-core/onlineManager.js`; it never consults `navigator.onLine`.
 * Those events fire on a TRANSITION, so a page LOADED while already offline
 * never receives one and reports itself online forever.
 *
 * That is not a cosmetic problem, and it lands hardest on exactly the page this
 * feature exists for: on `/offline`, `useOnlineStatus()` returned true, so the
 * "You're offline" banner never rendered — and `assertOnline()` below did not
 * throw, so a session started offline lost the "every write is clearly refused"
 * guarantee and instead applied an optimistic patch that failed later at the
 * network layer with a generic error.
 *
 * A one-time seed, deliberately — NOT a replacement for TanStack's event
 * listeners. Replacing `setEventListener` looks tidier but is wrong: the manager
 * re-runs the setup on every re-subscribe, and `useOnlineStatus` passes a fresh
 * closure to `useSyncExternalStore` on each render, so every re-render would
 * re-seed from `navigator.onLine` and clobber any `onlineManager.setOnline()`
 * the app or a test had performed. Seeding once at module load fixes the cold
 * start and leaves TanStack's own `online`/`offline` listeners authoritative for
 * every subsequent transition.
 */
if (typeof window !== "undefined" && typeof navigator !== "undefined") {
  onlineManager.setOnline(navigator.onLine);
}

/**
 * Connectivity is read from TanStack's `onlineManager` rather than
 * `navigator.onLine` directly: it is the same signal the query layer already
 * uses for retry/pause decisions, so the UI and the cache can never disagree
 * about whether we are online.
 */
export function isOnline(): boolean {
  return onlineManager.isOnline();
}

/**
 * Guard for every `mutationFn`. THROWS rather than returning an `ActionResult`
 * failure: TanStack treats a thrown error as the mutation's error path, which
 * is what fires the existing targeted rollback and the `showMutationError`
 * toast. A returned value would look like success to `useMutation`, leaving the
 * optimistic patch applied over data that was never written.
 */
export function assertOnline(): void {
  if (!onlineManager.isOnline()) throw new Error(OFFLINE_MESSAGE);
}

/**
 * Subscribe a component to connectivity. The server snapshot is `true` so the
 * server-rendered markup always matches the client's first paint; assuming
 * offline during SSR would produce a hydration mismatch (the failure shape of
 * gotcha-50).
 */
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(
    (onChange) => onlineManager.subscribe(onChange),
    () => onlineManager.isOnline(),
    () => true,
  );
}
