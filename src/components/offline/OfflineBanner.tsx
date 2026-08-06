"use client";

import { WifiOff } from "lucide-react";
import { useOnlineStatus } from "@/lib/offline/online-status";

/** Persistent bar shown whenever the app cannot reach the network. */
export function OfflineBanner() {
  const online = useOnlineStatus();
  if (online) return null;

  return (
    <div
      role="status"
      className="bg-muted text-muted-foreground flex items-center gap-2 border-b px-4 py-2 text-sm"
    >
      <WifiOff className="size-4" aria-hidden />
      <span>
        You&rsquo;re offline. This board is read-only until you reconnect.
      </span>
    </div>
  );
}
