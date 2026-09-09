"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { updateProfileThemePreset } from "@/lib/profile/actions";
import {
  applyThemePreset,
  DEFAULT_THEME_PRESET,
  isThemePresetId,
  THEME_PRESET_ATTR,
  THEME_PRESET_STORAGE_KEY,
  type ThemePresetId,
} from "./presets";

/** What `<html>` currently says. The server has no DOM, so it says default. */
function attributePreset(): ThemePresetId {
  if (typeof document === "undefined") return DEFAULT_THEME_PRESET;
  const v = document.documentElement.getAttribute(THEME_PRESET_ATTR);
  return isThemePresetId(v) ? v : DEFAULT_THEME_PRESET;
}

function remember(id: ThemePresetId): void {
  try {
    localStorage.setItem(THEME_PRESET_STORAGE_KEY, id);
  } catch {
    // Private mode / storage disabled. The server value still persists the
    // choice; only the pre-hydration no-flash path is lost.
  }
}

/**
 * Owns the theme-preset selection for the settings tile.
 *
 * The swatch must feel like a light switch, so the DOM attribute and
 * localStorage are written SYNCHRONOUSLY inside the event handler — the whole
 * chrome re-tints on the same frame as the click, with no server round-trip in
 * the way. The Server Action that follows only makes the choice durable; if it
 * fails, everything is put back and the error surfaces.
 *
 * Pass `initial` (the server-read value) wherever the caller renders on the
 * server: initialising from the DOM alone would render "keystone" during SSR
 * and the user's preset after hydration, which is a hydration mismatch on the
 * radio's `checked`. Omitting it is fine in a purely client-mounted caller.
 */
export function useThemePreset(initial?: ThemePresetId): {
  preset: ThemePresetId;
  setPreset: (id: ThemePresetId) => void;
  pending: boolean;
  error: string | null;
  /** Re-reads `<html data-theme-preset>` into state. For a caller that renders
   *  without an `initial` (nothing to hydrate-mismatch on), this catches the
   *  DOM up if something else changed the attribute since mount — e.g. the
   *  header dropdown calls it on `onOpenChange` so a value the settings tile
   *  just wrote elsewhere on the page is reflected next time it opens. */
  refresh: () => void;
} {
  const [preset, setPresetState] = useState<ThemePresetId>(
    () => initial ?? attributePreset(),
  );
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setPresetState(attributePreset());
  }, []);

  // Two independent renderers of the same DOM attribute (the header
  // `ThemeToggle` radio group and this settings tile) can both mount at once.
  // Without this, only the one that changed the attribute knows about the
  // change until its own next open/mount — the other goes stale. Observe
  // `<html data-theme-preset>` directly so either surface picks up a change
  // made through the other, on the same tick it happens.
  useEffect(() => {
    if (
      typeof document === "undefined" ||
      typeof MutationObserver === "undefined"
    ) {
      return;
    }
    const observer = new MutationObserver(() => refresh());
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: [THEME_PRESET_ATTR],
    });
    return () => observer.disconnect();
  }, [refresh]);

  const setPreset = useCallback(
    (next: ThemePresetId) => {
      setError(null);
      if (next === preset) return;

      const previous = preset;
      setPresetState(next);
      applyThemePreset(next);
      remember(next);

      startTransition(async () => {
        const res = await updateProfileThemePreset({ themePreset: next });
        if (res.ok) return;
        // Revert every surface we optimistically changed, in the same order.
        setPresetState(previous);
        applyThemePreset(previous);
        remember(previous);
        setError(res.error);
      });
    },
    [preset],
  );

  return { preset, setPreset, pending, error, refresh };
}
