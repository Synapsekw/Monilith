"use client";

import { onlineManager } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { OFFLINE_MESSAGE } from "./constants";

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
