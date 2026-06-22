"use client";

import { useEffect, useRef } from "react";
import { useBoardPresenceContext } from "./presence-context";
import type { PresenceFocus } from "./presence-types";

/** Call from an editable element. Reports focus when `active` is true and clears
 *  on blur/unmount. */
export function usePresenceFocus(target: PresenceFocus | null, active: boolean) {
  const { setFocus } = useBoardPresenceContext();
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
