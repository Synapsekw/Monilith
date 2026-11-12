"use client";

import { type ThemeReachId } from "@/lib/theme/presets";
import { useThemeReach } from "@/lib/theme/use-theme-reach";
import { cn } from "@/lib/utils";

const ERROR_ID = "theme-reach-error";

/** Ordered least to most colour, so arrow-down always means "more". The ids are
 *  typed against `ThemeReachId`, so a renamed id fails the build here. */
const OPTIONS: ReadonlyArray<{
  id: ThemeReachId;
  label: string;
  description: string;
}> = [
  {
    id: "subtle",
    label: "Subtle",
    description: "Colour stays in the frame around your work.",
  },
  {
    id: "tinted",
    label: "Tinted",
    description: "Your theme lightly tints surfaces, hover and charts.",
  },
  {
    id: "vivid",
    label: "Vivid",
    description: "Stronger tint, plus a glow behind page headers.",
  },
];

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
                    ? "border-border-bright bg-surface-muted"
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
