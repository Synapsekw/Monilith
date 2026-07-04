"use client";

import { useEffect, useRef } from "react";
import { usePresenceFocusStore } from "./presence-focus-store";
import type { PresenceFocus } from "./presence-types";

/** Call from an editable element. Reports focus when `active` is true and clears
 *  on blur/unmount. Reads `setFocus` from the presence focus store (a stable
 *  reference, so this hook never re-renders on presence heartbeats); it defaults
 *  to a no-op until BoardViews feeds the store, so it's inert in isolated
 *  component tests — nothing to broadcast to. */
export function usePresenceFocus(
  target: PresenceFocus | null,
  active: boolean,
) {
  const setFocus = usePresenceFocusStore((s) => s.setFocus);
  const prev = useRef(false);
  useEffect(() => {
    if (active && target) {
      setFocus(target);
      prev.current = true;
    } else if (prev.current) {
      setFocus(null);
      prev.current = false;
    }
    return () => {
      if (prev.current) setFocus(null);
    };
    // We intentionally depend on target's stable scalar fields, not the object
    // identity (which changes every render), to avoid re-firing on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, target?.targetId, target?.viewKind, setFocus]);
}
