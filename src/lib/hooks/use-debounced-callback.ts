import { useCallback, useEffect, useRef } from "react";

/**
 * Trailing-edge debounce. The returned callback resets its timer on every call
 * and fires `fn` once, `delayMs` after the last call, with that call's args.
 * Stable identity (safe in deps); pending timer is cleared on unmount.
 */
export function useDebouncedCallback<A extends unknown[]>(
  fn: (...args: A) => void,
  delayMs: number,
): (...args: A) => void {
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return useCallback(
    (...args: A) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        fnRef.current(...args);
      }, delayMs);
    },
    [delayMs],
  );
}
