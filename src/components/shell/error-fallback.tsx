"use client";

import { useEffect } from "react";
import { WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useOnlineStatus } from "@/lib/offline/online-status";

/**
 * Shared fallback body for route-level error boundaries (error.tsx files).
 * Copy must not depend on error.message — Next strips server error messages
 * in production; only `digest` survives (shown for support correlation).
 *
 * OFFLINE. A dropped connection is the single most common reason this boundary
 * renders, and "an unexpected error" is a lie about it — nothing is broken and
 * there is no support ticket to file. Offline it therefore names the real cause
 * and points at what still works (already-opened boards, read-only).
 *
 * It does NOT reload or navigate itself. `<OfflineNavigationGuard>` sends link
 * clicks to the service worker BEFORE they fail, which is the fix; by the time
 * this boundary renders the URL is the previous page's, so a reload would go to
 * the wrong place — and if the reloaded document errored too, it would be an
 * unbounded reload loop. Recovery stays the user's explicit choice.
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
  const offline = !useOnlineStatus();

  useEffect(() => {
    // Observability: route errors would otherwise vanish client-side.
    console.error(error);
  }, [error]);

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
