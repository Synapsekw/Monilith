"use client";

import { useEffect, useState } from "react";
import { OfflineBoard } from "@/components/offline/OfflineBoard";
import { OfflineBanner } from "@/components/offline/OfflineBanner";
import { LAST_USER_KEY } from "@/lib/offline/constants";

type Resolved = {
  ready: boolean;
  target: { boardId: string; userId: string } | null;
};

/**
 * The document the service worker serves for any navigation that fails.
 *
 * Client-only and free of user data: it is precached, so anything baked into
 * its markup would be readable by the next person to use the machine. It reads
 * the attempted path from `location` after mount — during prerender there is no
 * URL to read, and guessing one would be a hydration mismatch.
 */
export default function OfflinePage() {
  const [resolved, setResolved] = useState<Resolved>({
    ready: false,
    target: null,
  });

  useEffect(() => {
    const match = /^\/boards\/([0-9a-f-]{36})/.exec(window.location.pathname);
    const userId = window.localStorage.getItem(LAST_USER_KEY);
    const target = match && userId ? { boardId: match[1], userId } : null;
    // `location`/`localStorage` are external systems only readable post-mount
    // (no URL during prerender) — same one-shot-read exemption as
    // `useReducedMotion` / `use-dock-state` (react-hooks/set-state-in-effect).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setResolved({ ready: true, target });
  }, []);

  if (!resolved.ready) return null;

  const { target } = resolved;
  if (!target) {
    return (
      <div className="p-6">
        <OfflineBanner />
        <p className="text-muted-foreground pt-4 text-sm">
          You&rsquo;re offline. Boards you have already opened are available;
          everything else needs a connection.
        </p>
      </div>
    );
  }

  return <OfflineBoard boardId={target.boardId} userId={target.userId} />;
}
