"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};
const getSnapshot = () => true;
const getServerSnapshot = () => false;

/**
 * `false` on the server and during hydration, `true` from the first render
 * after hydration. Gate any render value that only the browser can compute
 * (canvas text measurement, layout) behind it: React does not patch a
 * mismatched attribute during hydration, so a style computed differently on
 * the server would otherwise stick until that value changes again.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
