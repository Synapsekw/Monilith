"use client";

import { useEffect, useRef } from "react";
import { touchBoardVisit } from "./visit-actions";

/**
 * Stamp the caller's visit to a board ONCE per visit (spec §3.4): on
 * `visibilitychange → hidden`, on `pagehide`, or on unmount — whichever comes
 * first. A `sent` guard stops the second and third from writing again; it
 * resets when the tab becomes visible again, because that starts a new visit.
 * Failure is silent: the only consumer is the "changed since" chip on the next
 * visit.
 *
 * `enabled=false` makes it inert (the /offline replay has no server to write to).
 *
 * Dev-only note: React StrictMode mounts effects twice, so the first cleanup
 * fires one extra write in development. Production mounts once.
 */
export function useBoardVisitTouch(boardId: string, enabled = true): void {
  const sent = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    sent.current = false;

    const send = () => {
      if (sent.current) return;
      sent.current = true;
      void touchBoardVisit(boardId).catch(() => {
        /* silent by design (spec §3.4) */
      });
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") send();
      else sent.current = false;
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", send);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", send);
      send();
    };
  }, [boardId, enabled]);
}
