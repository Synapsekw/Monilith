"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * Marks a subtree as the OFFLINE, read-only render of a board (the `/offline`
 * route restoring a cached snapshot) as opposed to the ONLINE render of the
 * same `<BoardViews>` tree.
 *
 * Why this exists: `OfflineBoard` reuses the real `<BoardViews>` to draw the
 * cached board rather than forking a parallel read-only renderer (see the
 * comment on `OfflineBoard.tsx` — `access="viewer"` is the read-only story).
 * But `BoardViews` unconditionally does three things that are only correct
 * ONLINE:
 *   1. `useBoardSnapshot` WRITES the current render props back into the query
 *      cache with a fresh `savedAt` — on the offline route this would
 *      re-stamp the very snapshot the device is offline-reading, defeating
 *      the 7-day `OFFLINE_WINDOW_MS` cap (a board you keep opening offline
 *      would never age out).
 *   2. `<OfflinePersistence>` subscribes the persister and re-writes the
 *      whole client to IndexedDB — a pointless write on a device we already
 *      know is offline.
 *   3. Realtime + presence open Supabase WebSocket channels — there is no
 *      network on this route by definition.
 *
 * Rather than thread an `isOffline` prop through every layer (or fork a
 * second board-view tree to maintain in parallel), `OfflineBoard` wraps its
 * `<BoardViews>` in `OfflineRenderProvider`, and each piece that must stand
 * down reads `useIsOfflineRender()` and no-ops. Default is `false` so every
 * normal (online) render is unaffected without this provider anywhere above
 * it.
 *
 * Do not delete this as "unnecessary indirection" — without it, the only way
 * to suppress these writes/subscriptions is to duplicate `BoardViews` for the
 * offline path, which is the exact drift this design set out to avoid.
 */
const OfflineRenderContext = createContext(false);

export function OfflineRenderProvider({ children }: { children: ReactNode }) {
  return (
    <OfflineRenderContext.Provider value={true}>
      {children}
    </OfflineRenderContext.Provider>
  );
}

export function useIsOfflineRender(): boolean {
  return useContext(OfflineRenderContext);
}
