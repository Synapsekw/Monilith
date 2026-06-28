"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(pointer: coarse)";

function subscribe(callback: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mql = window.matchMedia(QUERY);
  mql.addEventListener("change", callback);
  return () => mql.removeEventListener("change", callback);
}

function getSnapshot(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(QUERY).matches;
}

// SSR/first-paint default: assume a fine pointer so we render the desktop
// affordances, then hydrate to the real value. Avoids a touch-styled flash on
// desktop and keeps RSC/PPR output stable.
function getServerSnapshot(): boolean {
  return false;
}

/**
 * `true` when the primary pointer is coarse (finger). Backed by
 * `matchMedia('(pointer: coarse)')`, NOT user-agent sniffing — an iPad with a
 * trackpad correctly reports a fine pointer and keeps desktop affordances.
 */
export function useCoarsePointer(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
