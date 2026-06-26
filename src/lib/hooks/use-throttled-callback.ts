import { useCallback, useEffect, useRef } from "react";

/**
 * Trailing-only throttle. The first call opens a window and schedules a single
 * flush `intervalMs` later that runs `fn` with the LATEST args seen in the
 * window; calls during the window are coalesced (no reschedule). After the
 * flush, the next call opens a new window. Matches the board-presence throttle.
 * Stable identity; pending timer cleared on unmount.
 */
export function useThrottledCallback<A extends unknown[]>(
  fn: (...args: A) => void,
  intervalMs: number,
): (...args: A) => void {
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<A | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return useCallback(
    (...args: A) => {
      latest.current = args;
      if (timer.current) return;
      timer.current = setTimeout(() => {
        timer.current = null;
        const a = latest.current;
        latest.current = null;
        if (a) fnRef.current(...a);
      }, intervalMs);
    },
    [intervalMs],
  );
}
