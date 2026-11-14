"use client";

import { Check } from "lucide-react";
import {
  THEME_PRESETS,
  swatchAccentFill,
  swatchAccentRing,
  swatchChromeFill,
  type ThemePresetId,
} from "@/lib/theme/presets";
import { useThemePreset } from "@/lib/theme/use-theme-preset";
import { cn } from "@/lib/utils";

const ERROR_ID = "theme-preset-error";

/**
 * The theme-preset picker. Real (visually hidden) radios rather than buttons,
 * so the group announces as a radiogroup and arrow keys move through it — the
 * same recipe as `AppearanceForm`, which sits directly above it in Preferences.
 *
 * Each tile previews the preset in BOTH modes at once: the light frame with its
 * accent on the left, the dark frame with its accent on the right. A preset is
 * not a third mode — it re-tints whichever mode you are in — and a single-tone
 * swatch would imply otherwise. Each half's ground is that mode's real wash,
 * first stop to last (`swatchChromeFill`), so the tile shows the frame the app
 * will actually be drawn on. The accent is a round dot, or a short gradient
 * pill when the preset carries a second accent; where it would sink into its
 * own wash — every light half, whose frame is a saturated mid-dark in the
 * accent's own hue — it takes a white hairline (`swatchAccentRing`).
 *
 * The grid fills its column with as many 84px-minimum tiles as fit, so it
 * follows the width it is really given — the fixed 280px settings column on a
 * desktop (three across), the full row once the settings row stacks — rather
 * than the viewport, which says nothing about that column.
 *
 * There is no Save button: selection is the commit. The attribute and
 * localStorage are written synchronously by the hook, so the whole app re-tints
 * on the click; the write behind it is what carries the choice to the next
 * device, and a failure puts everything back.
 */
export function ThemePresetForm({
  currentPreset,
}: {
  currentPreset: ThemePresetId;
}) {
  const { preset, setPreset, pending, error } = useThemePreset(currentPreset);

  return (
    <div className="space-y-2">
      <fieldset aria-busy={pending}>
        <legend className="sr-only">Theme</legend>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(5.25rem,1fr))] gap-2">
          {THEME_PRESETS.map((p) => {
            const selected = p.id === preset;
            return (
              <label
                key={p.id}
                data-selected={selected ? "true" : undefined}
                className={cn(
                  "ease-keystone flex min-w-0 cursor-pointer flex-col gap-1.5 rounded-sm border p-1.5 transition-colors",
                  "has-[:focus-visible]:ring-ring/50 has-[:focus-visible]:ring-2",
                  "pointer-coarse:min-h-11",
                  // Selected = bright hairline + a brand ring around it + the
                  // check by the label. The border alone (26% white on a
                  // near-black card) was a guess, not a state.
                  selected
                    ? "border-border-bright ring-primary ring-1"
                    : "border-border hover:border-border-hover",
                )}
              >
                <input
                  type="radio"
                  name="theme-preset"
                  value={p.id}
                  className="sr-only"
                  checked={selected}
                  onChange={() => setPreset(p.id)}
                  aria-describedby={error ? ERROR_ID : undefined}
                />
                {/* Inline hex is correct here and nowhere else: the swatch IS
                    the data. Semantic tokens describe the ACTIVE palette, and
                    this tile has to show every palette on offer. */}
                <span
                  aria-hidden
                  className="flex h-7 overflow-hidden rounded-sm"
                >
                  {(["light", "dark"] as const).map((mode) => {
                    const swatch = p.swatch[mode];
                    // A 10px dot cannot show two stops — a second accent
                    // stretches it into a 20×10 pill so the gradient reads.
                    const pill = swatch.accent2 !== undefined;
                    return (
                      <span
                        key={mode}
                        className="flex flex-1 items-center justify-center"
                        data-swatch-chrome={mode}
                        style={{ background: swatchChromeFill(swatch) }}
                      >
                        <span
                          data-swatch-accent={mode}
                          data-swatch-shape={pill ? "pill" : "dot"}
                          className={cn(
                            "rounded-full",
                            pill ? "h-2.5 w-5" : "size-2.5",
                          )}
                          style={{
                            background: swatchAccentFill(swatch),
                            boxShadow: swatchAccentRing(swatch),
                          }}
                        />
                      </span>
                    );
                  })}
                </span>
                <span
                  className={cn(
                    "flex min-w-0 items-center justify-center gap-1 text-xs",
                    selected
                      ? "text-foreground font-medium"
                      : "text-muted-foreground",
                  )}
                >
                  {selected ? (
                    <Check
                      aria-hidden
                      data-selected-check=""
                      className="text-primary size-3 shrink-0"
                    />
                  ) : null}
                  <span className="truncate">{p.label}</span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>
      {error ? (
        <p id={ERROR_ID} role="alert" className="text-destructive text-xs">
          {error}
        </p>
      ) : null}
    </div>
  );
}
