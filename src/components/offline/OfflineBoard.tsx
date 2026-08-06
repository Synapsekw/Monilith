"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { persistQueryClientRestore } from "@tanstack/react-query-persist-client";
import { BoardViews } from "@/components/boards/BoardViews";
import { OfflineBanner } from "@/components/offline/OfflineBanner";
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
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void persistQueryClientRestore({
      queryClient: qc,
      ...persistOptionsFor(userId),
    })
      .catch((error: unknown) => {
        // Recoverable and already user-visible (falls through to the same
        // "isn't available offline" copy as a never-cached board below), but
        // that copy can't distinguish "never cached" from "restore failed" —
        // this is the diagnostic trail for the latter.
        console.warn(
          "[offline] failed to restore persisted query cache",
          error,
        );
      })
      .then(() => {
        if (!cancelled) setRestored(true);
      });
    return () => {
      cancelled = true;
    };
  }, [qc, userId]);

  if (!restored) {
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
        <BoardViews
          payload={snapshot.payload}
          members={snapshot.members}
          initialViewId={snapshot.initialViewId}
          currentUserId={snapshot.currentUserId}
          access="viewer"
          grants={[]}
        />
      </div>
    </div>
  );
}
