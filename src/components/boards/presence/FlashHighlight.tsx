"use client";

import { useBoardPresenceContextOptional } from "@/lib/boards/presence-context";
import { cn } from "@/lib/utils";

/**
 * A brief last-write-wins flash overlay for the cell the local user currently
 * has focused when a remote change lands on it. Reads `flashTargetId` from
 * presence context; renders a short accent ring/pulse when it matches `target`,
 * and nothing otherwise (or when there is no provider).
 *
 * Presentational only — render it inside a `position: relative` host; it pins
 * itself to the host's edges. The accent ring uses the brand/focus token
 * (`ring`) so chrome stays monochrome and color is the single sanctioned
 * accent. Decorative: `aria-hidden` (the attributed message carries meaning).
 */
export function FlashHighlight({
  target,
  className,
}: {
  target: string;
  className?: string;
}) {
  const presence = useBoardPresenceContextOptional();
  if (!presence) return null;
  if (presence.flashTargetId !== target) return null;

  return (
    <span
      aria-hidden
      className={cn(
        "ring-ring animate-fadein pointer-events-none absolute inset-0 z-10 rounded-md ring-2 ring-inset",
        className,
      )}
    />
  );
}
