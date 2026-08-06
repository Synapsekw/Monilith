"use client";

import { useEffect } from "react";

/**
 * Registers the service worker AFTER load, on idle. Registering during
 * hydration would have it competing with the board's own JavaScript for the
 * main thread on exactly the paint the performance budget protects.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

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
