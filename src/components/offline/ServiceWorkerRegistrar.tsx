"use client";

import { useEffect } from "react";

/** Must match CACHE_PREFIX in public/sw.js — we only ever delete our own. */
const CACHE_PREFIX = "monolith-offline";

/**
 * Registers the service worker AFTER load, on idle. Registering during
 * hydration would have it competing with the board's own JavaScript for the
 * main thread on exactly the paint the performance budget protects.
 *
 * PRODUCTION ONLY. `sw.js` serves `/_next/static/**` cache-first, and its own
 * rule #1 justifies that with "filenames change whenever their contents
 * change, so a stale entry is impossible". That premise holds for a production
 * build and is FALSE for Turbopack dev, which reuses a chunk's filename across
 * recompiles — verified directly: after editing a source file,
 * `/_next/static/chunks/src_0hajv86._.js` kept its exact name while its bytes
 * changed (76,036 → 76,124). Cache-first then pins the browser to whichever
 * chunks it cached first and the app dies with
 *
 *   Module [project]/src/lib/boards/data:5d4ff0 ... was instantiated because it
 *   was required from module ... but the module factory is not available.
 *
 * That failure survives a dev-server restart and `rm -rf .next`, because the
 * staleness lives in the browser, not the build.
 *
 * In dev we therefore UNREGISTER rather than merely skip: skipping alone would
 * leave an already-installed worker from an earlier run happily serving stale
 * chunks forever, with no way for a developer to discover why.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    if (process.env.NODE_ENV !== "production") {
      void navigator.serviceWorker
        .getRegistrations()
        .then((regs) => Promise.all(regs.map((r) => r.unregister())))
        .catch(() => {
          // Teardown is best-effort; failing it must not break the app.
        });
      if ("caches" in window) {
        void window.caches
          .keys()
          .then((keys) =>
            Promise.all(
              keys
                .filter((k) => k.startsWith(CACHE_PREFIX))
                .map((k) => window.caches.delete(k)),
            ),
          )
          .catch(() => {
            // Same: a cache we cannot drop costs staleness, never the app.
          });
      }
      return;
    }

    const register = () => {
      void navigator.serviceWorker.register("/sw.js").catch(() => {
        // A failed registration costs offline support, never the app itself.
      });
    };

    const idle = window.requestIdleCallback?.bind(window);
    if (idle) {
      const handle = idle(register, { timeout: 5000 });
      return () => window.cancelIdleCallback?.(handle);
    }
    const t = window.setTimeout(register, 2000);
    return () => window.clearTimeout(t);
  }, []);

  return null;
}
