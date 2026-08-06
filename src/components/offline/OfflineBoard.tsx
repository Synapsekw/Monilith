"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { persistQueryClientRestore } from "@tanstack/react-query-persist-client";
import { BoardViews } from "@/components/boards/BoardViews";
import { enforceOfflineGrace } from "@/lib/offline/entitlement";
import { OfflineBanner } from "@/components/offline/OfflineBanner";
import { OfflineRenderProvider } from "@/lib/offline/offline-render-context";
import { persistOptionsFor } from "@/lib/offline/persister";
import { boardSnapshotKey, type BoardSnapshot } from "@/lib/offline/snapshot";

/**
 * Renders a board with no server. This is the ONE place that restores the
 * persisted cache — everywhere else the RSC payload is fresher.
 *
 * `access="viewer"` is the whole read-only story: the board already threads
 * `BoardAccess` into all four view renderers and derives `canEdit = access !==
 * "viewer"` (see `BoardTableInner.tsx`). Offline reuses that rather than
 * introducing a second, parallel notion of read-only that would drift.
 */
export function OfflineBoard({
  boardId,
  userId,
}: {
  boardId: string;
  userId: string;
}) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<"checking" | "denied" | "restored">(
    "checking",
  );

  useEffect(() => {
    let cancelled = false;

    // The entitlement grace check runs HERE, not in `OfflinePersistence`.
    //
    // `OfflinePersistence` returns early on an offline render (it must not
    // re-subscribe the persister or re-stamp the identity marker on a device we
    // already know is offline), and that early return also skipped
    // `enforceOfflineGrace` — the only caller that wipes on entitlement lapse.
    // A user who only ever opened `/offline` was therefore never wiped, which
    // is precisely backwards: offline is where the grace window MATTERS, because
    // being offline is the reason the entitlement cannot be re-verified.
    //
    // It runs BEFORE the restore rather than alongside it so a lapsed
    // entitlement never renders. Enforcing after the restore would show the
    // board and only wipe it for next time, which is not enforcement.
    void enforceOfflineGrace(Date.now())
      .then(async (permitted) => {
        if (cancelled) return;
        if (!permitted) {
          setStatus("denied");
          return;
        }
        await persistQueryClientRestore({
          queryClient: qc,
          ...persistOptionsFor(userId),
        }).catch((error: unknown) => {
          // Recoverable and already user-visible (falls through to the same
          // "isn't available offline" copy as a never-cached board below), but
          // that copy can't distinguish "never cached" from "restore failed" —
          // this is the diagnostic trail for the latter.
          console.warn(
            "[offline] failed to restore persisted query cache",
            error,
          );
        });
        if (!cancelled) setStatus("restored");
      })
      .catch((error: unknown) => {
        // `enforceOfflineGrace` swallows its own failures today, so this is
        // unreachable — but an unhandled rejection here would leave the page
        // stuck on the skeleton forever, so it fails closed and visibly.
        console.error("[offline] grace check failed", error);
        if (!cancelled) setStatus("denied");
      });

    return () => {
      cancelled = true;
    };
  }, [qc, userId]);

  if (status === "denied") {
    return (
      <div className="text-muted-foreground p-6 text-sm">
        <OfflineBanner />
        <p className="pt-4">
          Offline access has expired. Reconnect to Monolith to keep reading your
          boards without a connection.
        </p>
      </div>
    );
  }

  if (status === "checking") {
    return (
      <div role="status" aria-busy="true" className="p-6">
        <div className="bg-muted h-8 w-48 animate-pulse rounded-md" />
      </div>
    );
  }

  const snapshot = qc.getQueryData<BoardSnapshot>(boardSnapshotKey(boardId));

  if (!snapshot) {
    return (
      <div className="text-muted-foreground p-6 text-sm">
        <OfflineBanner />
        <p className="pt-4">
          {/* Straight apostrophe (not &rsquo;) so it matches the test's
              /isn't available offline/i regex literally. */}
          This board isn&apos;t available offline. Open it once while connected
          and it will be here next time.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <OfflineBanner />
      {/* min-w-0 for the same reason the online board page carries it: board
          tables have a min-width and would otherwise push the PAGE sideways. */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* BoardViews is the ONLINE component; this provider tells its
            offline-aware pieces (useBoardSnapshot, OfflinePersistence,
            realtime/presence) to stand down — see offline-render-context.tsx
            for why. */}
        <OfflineRenderProvider>
          <BoardViews
            payload={snapshot.payload}
            members={snapshot.members}
            initialViewId={snapshot.initialViewId}
            currentUserId={snapshot.currentUserId}
            access="viewer"
            grants={[]}
          />
        </OfflineRenderProvider>
      </div>
    </div>
  );
}
