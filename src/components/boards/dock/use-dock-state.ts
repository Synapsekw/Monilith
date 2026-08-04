"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

/** Narrower than this and the dock stops being a column beside the board. */
export const DOCK_MIN_WIDTH = 320;
/** Wider than this and the dock is the page, not a dock. */
export const DOCK_MAX_WIDTH = 640;

type Stored = { open: boolean; width: number };

const keyFor = (boardId: string) => `monolith.dock.${boardId}`;

/** Single home for the width bound — the hook, the drag and the keyboard resize
 *  all clamp through this rather than re-deriving the range. */
export const clampDockWidth = (n: number) =>
  Math.min(DOCK_MAX_WIDTH, Math.max(DOCK_MIN_WIDTH, Math.round(n)));

const CLOSED: Stored = { open: false, width: DOCK_MIN_WIDTH };

/** Whatever this board remembers, sanitised. Never throws: corrupt or
 *  unavailable storage (private mode, quota) simply means "closed, default
 *  width" — it is not a condition worth surfacing to the user. */
function readStored(boardId: string): Stored {
  try {
    const raw = window.localStorage.getItem(keyFor(boardId));
    if (!raw) return CLOSED;
    const parsed = JSON.parse(raw) as Partial<Stored>;
    return {
      open: typeof parsed.open === "boolean" ? parsed.open : CLOSED.open,
      width:
        typeof parsed.width === "number"
          ? clampDockWidth(parsed.width)
          : CLOSED.width,
    };
  } catch {
    return CLOSED;
  }
}

/**
 * Dock open/width, remembered per board.
 *
 * Storage is read in an EFFECT, never during render. Seeding initial state from
 * localStorage renders one thing on the server and another in the browser,
 * which is a hydration mismatch (the failure shape of gotcha-50). The cost is
 * that a remembered-open dock expands one frame late; the alternative is a
 * console error and a client-side re-render of the whole board page.
 *
 * One state object rather than three, so the read costs exactly one extra
 * render — the same shape as `useReducedMotion`, disable comment included.
 */
export function useDockState(boardId: string) {
  const [state, setState] = useState<Stored & { hydrated: boolean }>({
    ...CLOSED,
    hydrated: false,
  });

  useEffect(() => {
    // Reading the remembered state during render is precisely the hydration
    // mismatch this hook exists to avoid; localStorage is an external system,
    // so post-mount is the only correct time to read it. Same shape (and same
    // exemption) as `useReducedMotion`.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState({ ...readStored(boardId), hydrated: true });
  }, [boardId]);

  const persist = useCallback(
    (next: Stored) => {
      try {
        window.localStorage.setItem(keyFor(boardId), JSON.stringify(next));
      } catch {
        /* storage unavailable — state still works for this session */
      }
    },
    [boardId],
  );

  // `persist` is a side effect, so it stays OUT of the state updater — React
  // may call an updater more than once, and a double write is a double write.
  const setOpen = useCallback(
    (open: boolean) => {
      setState((prev) => ({ ...prev, open }));
      persist({ open, width: state.width });
    },
    [persist, state.width],
  );

  const setWidth = useCallback(
    (next: number) => {
      const width = clampDockWidth(next);
      setState((prev) => ({ ...prev, width }));
      persist({ open: state.open, width });
    },
    [persist, state.open],
  );

  return {
    open: state.open,
    width: state.width,
    hydrated: state.hydrated,
    setOpen,
    setWidth,
  };
}

/** Tailwind's `md` breakpoint (48rem), expressed as "below it". */
const NARROW = "(max-width: 47.99rem)";

function subscribe(callback: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mql = window.matchMedia(NARROW);
  mql.addEventListener("change", callback);
  return () => mql.removeEventListener("change", callback);
}

function getSnapshot(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(NARROW).matches;
}

/** SSR/first-paint default: assume the wide layout, then hydrate to the truth.
 *  Same contract as `useCoarsePointer`. */
function getServerSnapshot(): boolean {
  return false;
}

/**
 * `true` below `md`, where the dock becomes a Sheet instead of a column.
 *
 * This is a JS read of the same breakpoint the classes use, and it is load-
 * bearing rather than cosmetic: a `md:hidden` Sheet would still be MOUNTED on a
 * desktop viewport, and a mounted Radix dialog traps focus and locks body
 * scroll however invisible it is. Picking the surface in JS renders exactly one
 * dock body at a time.
 */
export function useNarrowViewport(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
