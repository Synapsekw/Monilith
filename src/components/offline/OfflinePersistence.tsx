"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { persistQueryClientSubscribe } from "@tanstack/react-query-persist-client";
import {
  enforceOfflineGrace,
  rememberIdentity,
} from "@/lib/offline/entitlement";
import { persistOptionsFor } from "@/lib/offline/persister";

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

  useEffect(() => {
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
      unsubscribe = persistQueryClientSubscribe({
        queryClient,
        ...persistOptionsFor(userId),
      });
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [queryClient, userId]);

  return null;
}
