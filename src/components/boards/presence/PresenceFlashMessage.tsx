"use client";

import { useEffect, useState } from "react";

import type { LwwMessage } from "@/lib/boards/use-lww-flash";

const AUTO_DISMISS_MS = 2500;

/**
 * An ephemeral, attributed last-write-wins notice ("Sam changed this just
 * now"). A restrained "toast-lite": a fixed bottom-right pill on a muted
 * surface with a hairline border that appears whenever a new `message` arrives
 * (keyed on `message.id`) and auto-dismisses after ~2.5s.
 *
 * Accessible: `role="status"` + `aria-live="polite"` so assistive tech
 * announces it without stealing focus. Chrome stays monochrome — no accent.
 */
export function PresenceFlashMessage({
  message,
}: {
  message: LwwMessage | null;
}) {
  // Track the id we've auto-dismissed so a new message (new id) re-shows
  // without a synchronous setState in the effect body. setState only ever
  // fires asynchronously from the timeout below.
  const [dismissedId, setDismissedId] = useState<number | null>(null);

  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setDismissedId(message.id), AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [message?.id, message]);

  if (!message || message.id === dismissedId) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="bg-surface-muted text-muted-foreground animate-fadein fixed right-4 bottom-4 z-50 max-w-xs rounded-md border px-3 py-2 text-xs shadow-sm"
    >
      {message.text}
    </div>
  );
}
