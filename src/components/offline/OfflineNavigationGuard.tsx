"use client";

import { useEffect } from "react";
import { useOnlineStatus } from "@/lib/offline/online-status";

/**
 * Makes in-app link clicks reach the service worker while offline.
 *
 * THE BUG THIS FIXES. `public/sw.js` falls back to the precached `/offline`
 * document for any navigation that fails — but only for `request.mode ===
 * "navigate"`, i.e. a real DOCUMENT navigation (reload, typed URL, hard link).
 * Clicking a board in the sidebar is a CLIENT-side navigation: Next.js fetches
 * an RSC payload, which is a plain `fetch` and never enters the worker's
 * navigate branch. Offline that fetch fails, the route error boundary renders,
 * and — measured — the URL does not even change, because Next only pushes
 * history AFTER the payload arrives. So the user is stranded on the previous
 * page with "Something went wrong", and nothing about the situation says
 * "offline".
 *
 * Intercepting BEFORE the soft navigation starts is the only fix that lands on
 * the right URL. Reloading from the error boundary afterwards would reload the
 * page the user was already on, never the board they clicked.
 *
 * Capture phase, on `document`, so it runs before Next's `<Link>` handler (which
 * is delegated to the React root and bails on `event.defaultPrevented` — see
 * `linkClicked` in `next/dist/client/link.js`). `preventDefault()` is therefore
 * enough; `stopPropagation()` would also silence unrelated app handlers for no
 * benefit.
 *
 * Online it attaches NO listener at all, so the normal client-side router is
 * untouched — this component costs one subscription and nothing else.
 */
export function OfflineNavigationGuard() {
  const online = useOnlineStatus();

  useEffect(() => {
    if (online) return;

    const onClick = (event: MouseEvent) => {
      // Someone upstream already claimed this click (a menu, a dialog, a
      // component that navigates itself) — leave it to them.
      if (event.defaultPrevented) return;
      // Only a plain primary click is a navigation we own. Modified clicks mean
      // "new tab" / "new window" / "download" / "save"; the browser's own
      // handling of those is correct and a document navigation would break it.
      if (event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
        return;

      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a[href]");
      // `instanceof HTMLAnchorElement` rather than a tag-name check: an `<a>`
      // inside an SVG is an SVGAElement whose `href` is an SVGAnimatedString,
      // not a resolved URL string.
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;

      let url: URL;
      try {
        // `anchor.href` is already absolute; the base is a belt-and-braces
        // fallback for an anchor that is not yet in a document.
        url = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }
      // Cross-origin, `mailto:`, `tel:` and `javascript:` all fail this: their
      // origin is either another site's or the opaque "null".
      if (url.origin !== window.location.origin) return;
      // Same document — an in-page anchor jump. There is nothing for the
      // service worker to serve, and a document navigation would throw away the
      // page the user is reading.
      if (
        url.pathname === window.location.pathname &&
        url.search === window.location.search
      )
        return;

      event.preventDefault();
      window.location.assign(url.href);
    };

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [online]);

  return null;
}
