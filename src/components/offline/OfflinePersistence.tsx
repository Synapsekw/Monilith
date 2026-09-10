"use client";

import { useEffect } from "react";
import type { QueryCacheNotifyEvent } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { persistQueryClientSave } from "@tanstack/react-query-persist-client";
import {
  enforceOfflineGrace,
  rememberIdentity,
} from "@/lib/offline/entitlement";
import { useIsOfflineRender } from "@/lib/offline/offline-render-context";
import { isPersistableKey, persistOptionsFor } from "@/lib/offline/persister";

/**
 * Whether a query-cache event is worth a persist write.
 *
 * `persistQueryClientSubscribe` (the library default this replaces) saves on
 * EVERY query- and mutation-cache event — every optimistic cell edit, every
 * realtime rAF flush — even though `shouldDehydrateQuery` in
 * `persistOptionsFor` only ever admits `boardSnapshot` queries into the
 * dehydrated payload. `useBoardSnapshot` (`snapshot.ts`) writes that query
 * exactly once per board/view, so every other event triggered a save whose
 * `persistClient` (an IDB read of the whole multi-board record, a structured
 * clone, merge and write — `persister.ts`) produced byte-identical output.
 * On a large board that is an IDB round trip per second of typing, for
 * nothing. Filtering to `added`/`updated` boardSnapshot events only — the
 * two event types that can carry new data into the cache — makes the
 * persister fire exactly when there is something new to write.
 */
function isBoardSnapshotWrite(event: QueryCacheNotifyEvent): boolean {
  return (
    (event.type === "added" || event.type === "updated") &&
    isPersistableKey(event.query.queryKey)
  );
}

/**
 * Attaches the persister to the LIVE QueryClient without restructuring the
 * provider tree.
 *
 * Subscribe-only, by design: it never calls `persistQueryClientRestore`.
 * Restoring here would hydrate a disk snapshot over a board the server just
 * seeded via `initialData`, replacing fresh data with older data on every
 * online load. Restoration happens only on the `/offline` route, which is the
 * one place there is no fresher source.
 */
export function OfflinePersistence({ userId }: { userId: string }) {
  const queryClient = useQueryClient();
  // On the `/offline` route's replay of a cached board, subscribing here
  // would re-write the whole persisted client to IndexedDB on a device we
  // already know is offline — see offline-render-context.tsx.
  const isOfflineRender = useIsOfflineRender();

  useEffect(() => {
    // RULING (B4): this early return also skips `enforceOfflineGrace` below,
    // and that is correct — but only because `OfflineBoard` now runs the grace
    // check itself, BEFORE it restores the cached snapshot. Enforcing here
    // instead would be too late: the board would already have rendered, and the
    // wipe would only take effect on the next load. Do not "fix" this by moving
    // the grace check back into this component; move it out of `OfflineBoard`
    // only if you have somewhere earlier to put it.
    if (isOfflineRender) return;

    rememberIdentity(userId);

    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    // The subscription must not start until the grace check resolves: if it
    // decides to wipe, a subscription established beforehand would just
    // repersist fresh snapshots into the IndexedDB store that was just
    // cleared. `cancelled` guards the case where this component unmounts
    // before the promise settles — subscribing after unmount would leak a
    // subscription with nothing to ever call its cleanup.
    void enforceOfflineGrace(Date.now()).then((permitted) => {
      if (cancelled || !permitted) return;
      const options = { queryClient, ...persistOptionsFor(userId) };

      // Subscribed directly to the query cache (not
      // `persistQueryClientSubscribe`, which also wires up the mutation cache
      // and saves on every event of either) so the filter in
      // `isBoardSnapshotWrite` above can gate the write. No mutation is ever
      // persisted here — `shouldDehydrateQuery` in `persistOptionsFor` never
      // admits mutations — so the mutation-cache subscription the library
      // helper adds would only ever produce more byte-identical saves.
      // Deliberately UNTHROTTLED. `persistQueryClientSave` dehydrates + writes
      // synchronously-ish on each call, so an unthrottled save is only safe
      // because `isBoardSnapshotWrite` narrows the trigger to a `boardSnapshot`
      // key write — one per board/view visit, driven by `useBoardSnapshot`'s
      // effect, NOT by cell edits or realtime traffic (those live under the
      // `board` key, which the filter rejects). If that filter ever widens to a
      // high-frequency key, reinstate a throttle here (the library's
      // `persistQueryClientSubscribe` defaults to 1s) — the assumption, not the
      // call, is what makes this cheap.
      const querySubscription = queryClient
        .getQueryCache()
        .subscribe((event) => {
          if (isBoardSnapshotWrite(event)) void persistQueryClientSave(options);
        });
      unsubscribe = querySubscription;

      // The subscription above performs NO initial save — it only fires from a
      // SUBSEQUENT query-cache event. The board snapshot is written exactly
      // once, by `useBoardSnapshot`'s effect, and that write has already
      // happened by the time the grace check above resolves — so without this
      // explicit first save there is no later event to trigger one, and
      // nothing is ever written to disk. Measured against a production build
      // before this line existed: the `keyval-store` database was never even
      // created while online, and `/offline` reported a just-visited board as
      // never visited. Do not remove it on the grounds that the subscription
      // "already covers" persistence; it does not cover anything that entered
      // the cache before it existed.
      void persistQueryClientSave(options);
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [queryClient, userId, isOfflineRender]);

  return null;
}
