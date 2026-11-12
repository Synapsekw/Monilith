"use client";

import { THEME_REACH_IDS, type ThemeReachId } from "@/lib/theme/presets";
import { useThemeReach } from "@/lib/theme/use-theme-reach";
import { cn } from "@/lib/utils";

const ERROR_ID = "theme-reach-error";

/** The copy for every reach. A `Record` keyed by `ThemeReachId`, so an id
 *  added to (or renamed in) the registry does not compile until it has a label
 *  and a description here. */
const REACH_COPY: Record<ThemeReachId, { label: string; description: string }> =
  {
    subtle: {
      label: "Subtle",
      description: "Colour stays in the frame around your work.",
    },
    tinted: {
      label: "Tinted",
      description: "Your theme lightly tints surfaces, hover and charts.",
    },
    vivid: {
      label: "Vivid",
      description: "Stronger tint, plus a glow behind page headers.",
    },
  };

/** The registry's order IS the display order: least to most colour, so
 *  arrow-down always means "more". */
const OPTIONS = THEME_REACH_IDS.map((id) => ({ id, ...REACH_COPY[id] }));

/**
 * The theme-reach picker: how far the chosen preset's colour travels into the
 * app. Real (visually hidden) radios rather than buttons, so the group
 * announces as a radiogroup and arrow keys move through it — the same recipe as
 * `ThemePresetForm` and `AppearanceForm`, which sit directly above it.
 *
 * Each radio is NAMED by its label alone and DESCRIBED by its one-liner, so a
 * screen reader hears "Vivid, radio button, 3 of 3" and then the explanation,
 * rather than one run-on name.
 *
 * There is no Save button: selection is the commit. The attribute and
 * localStorage are written synchronously by the hook, so the app re-tints on
 * the click; the write behind it is what carries the choice to the next device,
 * and a failure puts everything back.
 */
export function ThemeReachForm({
  currentReach,
}: {
  currentReach: ThemeReachId;
}) {
  const { reach, setReach, pending, error } = useThemeReach(currentReach);

  return (
    <div className="space-y-2">
      <fieldset aria-busy={pending}>
        <legend className="sr-only">Theme reach</legend>
        <div className="flex flex-col gap-2">
          {OPTIONS.map((opt) => {
            const selected = opt.id === reach;
            const labelId = `theme-reach-${opt.id}-label`;
            const descriptionId = `theme-reach-${opt.id}-description`;
            return (
              <label
                key={opt.id}
                className={cn(
                  "ease-keystone flex cursor-pointer flex-col gap-0.5 rounded-sm border px-3 py-2 transition-colors",
                  "has-[:focus-visible]:ring-ring/50 has-[:focus-visible]:ring-2",
                  "pointer-coarse:min-h-11",
                  selected
                    ? "border-border-bright bg-surface-muted ring-primary ring-1"
                    : "border-border hover:border-border-hover",
                )}
              >
                <input
                  type="radio"
                  name="theme-reach"
                  value={opt.id}
                  className="sr-only"
                  checked={selected}
                  onChange={() => setReach(opt.id)}
                  aria-labelledby={labelId}
                  aria-describedby={
                    error ? `${descriptionId} ${ERROR_ID}` : descriptionId
                  }
                />
                <span
                  id={labelId}
                  className={cn(
                    "text-sm",
                    selected
                      ? "text-foreground font-medium"
                      : "text-muted-foreground",
                  )}
                >
                  {opt.label}
                </span>
                <span
                  id={descriptionId}
                  className="text-muted-foreground text-xs"
                >
                  {opt.description}
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
