import { useState } from "react";

/**
 * Building blocks for a code-split, on-demand dialog (`next/dynamic`,
 * `ssr: false`): mount on first open, stay mounted afterwards, warm the chunk
 * on trigger intent. Used by BoardHeader's dialogs and the sidebar's
 * NewBoardDialog.
 */

/**
 * Memoise a chunk loader so the intent-prefetch and the `dynamic` render share
 * ONE in-flight `import()` instead of racing two.
 */
export function once<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined;
  return () =>
    (pending ??= load().catch((error: unknown) => {
      // Let a later open retry after a failed (e.g. offline) prefetch.
      pending = undefined;
      throw error;
    }));
}

/**
 * True from the first render where `open` is true, forever after. Gates the
 * mount of a lazy dialog: nothing is rendered (and no chunk requested) until
 * the first open, but the dialog then STAYS mounted with its real `open` prop —
 * exactly as before it was lazy — so Radix can play the close animation and the
 * dialog keeps its internal state (loaded rules, wizard step) across reopen.
 */
export function useEverOpened(open: boolean): boolean {
  const [everOpened, setEverOpened] = useState(open);
  // Adjusting state during render (not in an effect) is the documented React
  // pattern for deriving sticky state from a prop — no extra commit.
  if (open && !everOpened) setEverOpened(true);
  return open || everOpened;
}
