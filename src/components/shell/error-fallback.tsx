"use client";

import { useEffect } from "react";
import { WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { offlineRecoveryKey } from "@/lib/offline/constants";
import { useOnlineStatus } from "@/lib/offline/online-status";

/**
 * Shared fallback body for route-level error boundaries (error.tsx files).
 * Copy must not depend on error.message — Next strips server error messages
 * in production; only `digest` survives (shown for support correlation).
 *
 * OFFLINE. A dropped connection is the single most common reason this boundary
 * renders, and "an unexpected error" is a lie about it — nothing is broken and
 * there is no support ticket to file. Offline it names the real cause, and then
 * recovers.
 *
 * WHY A RELOAD IS THE RECOVERY. Measured against a production build: once the
 * network drops, the live app shell crashes into this boundary ON ITS OWN, with
 * `ChunkLoadError: Failed to load chunk /_next/static/chunks/…` — a lazily
 * imported chunk the worker never precached (it precaches `/offline`'s asset
 * graph, not the whole app's). No click is involved, so the browser is ALREADY
 * on the right URL, and a document navigation to that same URL is exactly what
 * is missing: `public/sw.js` answers it from the precached `/offline` shell,
 * which restores the cached board for this URL. Without it the page just sits
 * there.
 *
 * This is the CRASH case only. The other offline failure — clicking a board
 * link — is handled earlier by `<OfflineNavigationGuard>`, and must not reach a
 * reload: Next only pushes history after the RSC payload arrives, so on a failed
 * click the URL is still the PREVIOUS board's and reloading would restore the
 * wrong one.
 *
 * THE LOOP GUARD IS THE LOAD-BEARING PART. A boundary that reloads itself is an
 * unbounded reload loop the moment the reloaded document also errors. The
 * one-shot `sessionStorage` key (see `offlineRecoveryKey`) is written BEFORE the
 * reload and never after, so the second pass through this boundary at the same
 * pathname finds it set and stops. It is the only thing between the user and a
 * browser that reloads forever, so it fails CLOSED: if `sessionStorage` throws
 * (private mode, storage disabled) there is no guard, and therefore no reload.
 */
export function ErrorFallback({
  error,
  retry,
  title = "Something went wrong",
  description = "An unexpected error kept this page from loading. Your data is safe.",
}: {
  error: Error & { digest?: string };
  retry: () => void;
  title?: string;
  description?: string;
}) {
  const online = useOnlineStatus();
  const offline = !online;

  useEffect(() => {
    // Observability: route errors would otherwise vanish client-side.
    console.error(error);
  }, [error]);

  useEffect(() => {
    if (online) return;
    try {
      const key = offlineRecoveryKey(window.location.pathname);
      // Already spent this pathname's one recovery — the reloaded document
      // errored too. Stop here and let the user drive from the copy below.
      if (window.sessionStorage.getItem(key) !== null) return;
      // Written BEFORE the reload: a key set afterwards would never be written
      // at all, and the loop would be unbounded.
      window.sessionStorage.setItem(key, "1");
    } catch {
      // No usable guard means no bound on the loop — refuse to reload.
      return;
    }
    window.location.reload();
  }, [online]);

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 p-8 text-center">
      {offline ? (
        <>
          <WifiOff className="text-muted-foreground size-5" aria-hidden />
          <h2 className="text-foreground text-lg font-semibold">
            You&rsquo;re offline
          </h2>
          <p className="text-muted-foreground max-w-md text-sm">
            This page needs a connection. Boards you have already opened stay
            readable — reconnect to load anything else.
          </p>
        </>
      ) : (
        <>
          <h2 className="text-foreground text-lg font-semibold">{title}</h2>
          <p className="text-muted-foreground max-w-md text-sm">
            {description}
          </p>
        </>
      )}
      <Button onClick={retry} className="mt-2">
        Try again
      </Button>
      {!offline && error.digest ? (
        <p className="text-muted-foreground text-xs">
          Error code: {error.digest}
        </p>
      ) : null}
    </div>
  );
}
