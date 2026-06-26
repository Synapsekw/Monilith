import { useCallback, useEffect, useRef } from "react";

/**
 * Coalesces all calls within one animation frame into a single call with the
 * latest args. Use for per-pixel pointer work (e.g. live column-resize) so the
 * handler updates at most once per frame. Stable identity; cancels a pending
 * frame on unmount.
 */
export function useRafCallback<A extends unknown[]>(
  fn: (...args: A) => void,
): (...args: A) => void {
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });
  const frame = useRef<number | null>(null);
  const latest = useRef<A | null>(null);
  useEffect(
    () => () => {
      if (frame.current != null) cancelAnimationFrame(frame.current);
    },
    [],
  );
  return useCallback((...args: A) => {
    latest.current = args;
    if (frame.current != null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const a = latest.current;
      latest.current = null;
      if (a) fnRef.current(...a);
    });
  }, []);
}
