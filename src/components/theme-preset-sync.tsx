"use client";

import { use, useEffect } from "react";
import {
  applyThemePreset,
  THEME_PRESET_STORAGE_KEY,
  type ThemePresetId,
} from "@/lib/theme/presets";

/**
 * Reconciles the browser with the account.
 *
 * The inline head script paints the preset from localStorage before hydration,
 * which is what makes a reload flash-free — but localStorage is per-device, so a
 * fresh browser knows nothing. This component takes the server-read preset as an
 * UNAWAITED promise (streamed behind its own Suspense boundary so it never
 * blocks page content), then stamps it and writes it back to localStorage. The
 * server value wins: it is the account's choice, and after this pass the local
 * copy agrees, so the next load has no correction to make.
 *
 * Renders nothing. Mounted once per authenticated frame (the app shell and the
 * `/ask` layout) rather than in the root layout, because the read is per-user
 * and the root layout is shared with the signed-out pages.
 */
export function ThemePresetSync({
  preset,
}: {
  preset: Promise<ThemePresetId>;
}): null {
  const resolved = use(preset);

  useEffect(() => {
    applyThemePreset(resolved);
    try {
      localStorage.setItem(THEME_PRESET_STORAGE_KEY, resolved);
    } catch {
      // Private mode / storage disabled — the attribute is still applied, the
      // next load just pays one frame of default chrome before this runs.
    }
  }, [resolved]);

  return null;
}
