"use client";

import { useEffect, useState } from "react";

/**
 * `false` on the server, during hydration and until the document's web fonts
 * have loaded; `true` afterwards (immediately after mount when there is no
 * `document.fonts` or its status is already "loaded"). Canvas `measureText`
 * silently measures the fallback face while a font is still loading, so gate
 * one-shot text measurement behind this. Server and first client render agree
 * (both false), so there is no hydration mismatch.
 */
export function useFontsReady(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const done = () => {
      if (!cancelled) setReady(true);
    };
    const fonts = typeof document !== "undefined" ? document.fonts : undefined;
    if (!fonts || fonts.status === "loaded") done();
    else fonts.ready.then(done, done);
    return () => {
      cancelled = true;
    };
  }, []);
  return ready;
}
