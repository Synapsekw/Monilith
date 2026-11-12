"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { updateProfileThemeReach } from "@/lib/profile/actions";
import {
  applyThemeReach,
  DEFAULT_THEME_REACH,
  isThemeReachId,
  THEME_REACH_ATTR,
  THEME_REACH_STORAGE_KEY,
  type ThemeReachId,
} from "./presets";

/** What `<html>` currently says. The server has no DOM, so it says default. */
function attributeReach(): ThemeReachId {
  if (typeof document === "undefined") return DEFAULT_THEME_REACH;
  const v = document.documentElement.getAttribute(THEME_REACH_ATTR);
  return isThemeReachId(v) ? v : DEFAULT_THEME_REACH;
}

function remember(id: ThemeReachId): void {
  try {
    localStorage.setItem(THEME_REACH_STORAGE_KEY, id);
  } catch {
    // Private mode / storage disabled. The server value still persists the
    // choice; only the pre-hydration no-flash path is lost.
  }
}

/**
 * Owns the theme-reach selection for the settings control. The reach twin of
 * `useThemePreset`, deliberately the same shape.
 *
 * The DOM attribute and localStorage are written SYNCHRONOUSLY inside the event
 * handler, so every surface re-tints on the same frame as the click with no
 * server round-trip in the way. The Server Action that follows only makes the
 * choice durable; if it fails, everything is put back and the error surfaces.
 *
 * Pass `initial` (the server-read value) wherever the caller renders on the
 * server: initialising from the DOM alone would render "tinted" during SSR and
 * the user's reach after hydration — a hydration mismatch on the radio's
 * `checked`. Omitting it is fine in a purely client-mounted caller.
 */
export function useThemeReach(initial?: ThemeReachId): {
  reach: ThemeReachId;
  setReach: (id: ThemeReachId) => void;
  pending: boolean;
  error: string | null;
} {
  const [reach, setReachState] = useState<ThemeReachId>(
    () => initial ?? attributeReach(),
  );
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Follow `<html data-theme-reach>` if anything else changes it after mount
  // (a second control, or `ThemePresetSync` landing the account's value), so
  // the checked radio can never disagree with what is painted.
  useEffect(() => {
    if (
      typeof document === "undefined" ||
      typeof MutationObserver === "undefined"
    ) {
      return;
    }
    const observer = new MutationObserver(() =>
      setReachState(attributeReach()),
    );
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: [THEME_REACH_ATTR],
    });
    return () => observer.disconnect();
  }, []);

  const setReach = useCallback(
    (next: ThemeReachId) => {
      setError(null);
      if (next === reach) return;

      const previous = reach;
      setReachState(next);
      applyThemeReach(next);
      remember(next);

      startTransition(async () => {
        const res = await updateProfileThemeReach({ themeReach: next });
        if (res.ok) return;
        // Revert every surface we optimistically changed, in the same order.
        setReachState(previous);
        applyThemeReach(previous);
        remember(previous);
        setError(res.error);
      });
    },
    [reach],
  );

  return { reach, setReach, pending, error };
}
