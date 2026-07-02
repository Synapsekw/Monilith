import { useEffect, useMemo, useRef } from "react";

/** A debounced callback with an escape hatch to drop the pending invocation. */
export type DebouncedCallback<A extends unknown[]> = ((...args: A) => void) & {
  /** Discard the pending trailing-edge invocation, if any. */
  cancel: () => void;
};

/**
 * Trailing-edge debounce. The returned callback resets its timer on every call
 * and fires `fn` once, `delayMs` after the last call, with that call's args.
 * Stable identity (safe in deps); pending timer is cleared on unmount.
 * `.cancel()` drops a pending invocation (e.g. when the UI that scheduled it
 * closes before the quiet period elapses).
 */
export function useDebouncedCallback<A extends unknown[]>(
  fn: (...args: A) => void,
  delayMs: number,
): DebouncedCallback<A> {
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
  return useMemo(() => {
    const debounced = (...args: A) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        fnRef.current(...args);
      }, delayMs);
    };
    debounced.cancel = () => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
    };
    return debounced;
  }, [delayMs]);
}
