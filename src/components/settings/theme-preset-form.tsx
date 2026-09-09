"use client";

import { THEME_PRESETS, type ThemePresetId } from "@/lib/theme/presets";
import { useThemePreset } from "@/lib/theme/use-theme-preset";
import { cn } from "@/lib/utils";

const ERROR_ID = "theme-preset-error";

/**
 * The theme-preset picker. Real (visually hidden) radios rather than buttons,
 * so the group announces as a radiogroup and arrow keys move through it — the
 * same recipe as `AppearanceForm`, which sits directly above it in Preferences.
 *
 * Each tile previews the preset in BOTH modes at once: the light chrome with its
 * accent on the left, the dark chrome with its accent on the right. A preset is
 * not a third mode — it re-tints whichever mode you are in — and a single-tone
 * swatch would imply otherwise.
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
        <div className="grid grid-cols-3 gap-2">
          {THEME_PRESETS.map((p) => {
            const selected = p.id === preset;
            return (
              <label
                key={p.id}
                className={cn(
                  "ease-keystone flex cursor-pointer flex-col gap-1.5 rounded-sm border p-1.5 transition-colors",
                  "has-[:focus-visible]:ring-ring/50 has-[:focus-visible]:ring-2",
                  "pointer-coarse:min-h-11",
                  selected
                    ? "border-border-bright"
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
                    this tile has to show the five palettes on offer. */}
                <span
                  aria-hidden
                  className="flex h-7 overflow-hidden rounded-sm"
                >
                  <span
                    className="flex flex-1 items-center justify-center"
                    style={{ background: p.swatch.light.chrome }}
                  >
                    <span
                      className="size-2.5 rounded-full"
                      style={{ background: p.swatch.light.accent }}
                    />
                  </span>
                  <span
                    className="flex flex-1 items-center justify-center"
                    style={{ background: p.swatch.dark.chrome }}
                  >
                    <span
                      className="size-2.5 rounded-full"
                      style={{ background: p.swatch.dark.accent }}
                    />
                  </span>
                </span>
                <span
                  className={cn(
                    "text-center text-xs",
                    selected
                      ? "text-foreground font-medium"
                      : "text-muted-foreground",
                  )}
                >
                  {p.label}
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
