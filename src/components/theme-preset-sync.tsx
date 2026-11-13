"use client";

import { use, useEffect } from "react";
import {
  applyThemePreset,
  applyThemeReach,
  THEME_PRESET_STORAGE_KEY,
  THEME_REACH_STORAGE_KEY,
  type ThemePresetId,
  type ThemeReachId,
} from "@/lib/theme/presets";

function remember(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private mode / storage disabled — the attribute is still applied, the
    // next load just pays one frame of default chrome before this runs.
  }
}

/**
 * Reconciles the browser with the account.
 *
 * The inline head script paints the preset and the reach from localStorage
 * before hydration, which is what makes a reload flash-free — but localStorage
 * is per-device, so a fresh browser knows nothing. This component takes the
 * server-read values as UNAWAITED promises (streamed behind its own Suspense
 * boundary so they never block page content), then stamps them and writes them
 * back to localStorage. The server value wins: it is the account's choice, and
 * after this pass the local copy agrees, so the next load has no correction to
 * make.
 *
 * Preset and reach are two independent axes, so each has its own effect: a
 * change to one never re-stamps the other.
 *
 * Renders nothing. Mounted once per authenticated frame (the app shell and the
 * `/ask` layout) rather than in the root layout, because the read is per-user
 * and the root layout is shared with the signed-out pages.
 */
export function ThemePresetSync({
  preset,
  reach,
}: {
  preset: Promise<ThemePresetId>;
  reach: Promise<ThemeReachId>;
}): null {
  const resolvedPreset = use(preset);
  const resolvedReach = use(reach);

  useEffect(() => {
    applyThemePreset(resolvedPreset);
    remember(THEME_PRESET_STORAGE_KEY, resolvedPreset);
  }, [resolvedPreset]);

  useEffect(() => {
    applyThemeReach(resolvedReach);
    remember(THEME_REACH_STORAGE_KEY, resolvedReach);
  }, [resolvedReach]);

  return null;
}
