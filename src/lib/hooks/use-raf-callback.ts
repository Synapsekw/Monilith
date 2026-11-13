import { useCallback, useEffect, useRef } from "react";

/**
 * Coalesces all calls within one animation frame into a single call with the
 * latest args. Use for per-pixel pointer work (e.g. live column-resize) so the
 * handler updates at most once per frame. Returns `[schedule, cancel]`, both
 * with stable identity; a pending frame is cancelled on unmount.
 *
 * Call `cancel()` when the gesture ends and you apply the final value
 * yourself — otherwise the trailing frame lands AFTER your release handler
 * and can overwrite what it just set.
 */
export function useRafThrottle<A extends unknown[]>(
  fn: (...args: A) => void,
): [schedule: (...args: A) => void, cancel: () => void] {
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
  const schedule = useCallback((...args: A) => {
    latest.current = args;
    if (frame.current != null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const a = latest.current;
      latest.current = null;
      if (a) fnRef.current(...a);
    });
  }, []);
  const cancel = useCallback(() => {
    if (frame.current != null) cancelAnimationFrame(frame.current);
    frame.current = null;
    latest.current = null;
  }, []);
  return [schedule, cancel];
}

/** {@link useRafThrottle} without the cancel handle. */
export function useRafCallback<A extends unknown[]>(
  fn: (...args: A) => void,
): (...args: A) => void {
  return useRafThrottle(fn)[0];
}
