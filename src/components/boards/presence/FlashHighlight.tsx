"use client";

import { memo } from "react";
import { usePresenceFocusStore } from "@/lib/boards/presence-focus-store";
import { cn } from "@/lib/utils";

/**
 * A brief last-write-wins flash overlay for the cell the local user currently
 * has focused when a remote change lands on it. Subscribes to the presence
 * focus store with a boolean selector (`flashTargetId === target`), so only the
 * flashed cell (and the previously-flashed one) re-render — never every cell.
 *
 * Presentational only — render it inside a `position: relative` host; it pins
 * itself to the host's edges. The accent ring uses the brand/focus token
 * (`ring`) so chrome stays monochrome and color is the single sanctioned
 * accent. Decorative: `aria-hidden` (the attributed message carries meaning).
 */
export const FlashHighlight = memo(function FlashHighlight({
  target,
  className,
}: {
  target: string;
  className?: string;
}) {
  const isFlashing = usePresenceFocusStore((s) => s.flashTargetId === target);
  if (!isFlashing) return null;

  return (
    <span
      aria-hidden
      className={cn(
        "ring-ring animate-fadein pointer-events-none absolute inset-0 z-10 rounded-md ring-2 ring-inset",
        className,
      )}
    />
  );
});
