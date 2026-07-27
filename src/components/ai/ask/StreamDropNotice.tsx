"use client";

import { RotateCw, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kicker } from "@/components/ui/kicker";

/**
 * What a severed `/api/ask` stream turned into.
 *
 * `"none"`        — nothing to say (normal turn).
 * `"checking"`    — re-reading the thread to see whether the answer landed.
 * `"unrecovered"` — it hadn't landed yet; the user can check again.
 * `"recovered"`   — it had, and the real turn is now in the transcript.
 */
export type DropState = "none" | "checking" | "unrecovered" | "recovered";

/**
 * The visible state a dropped stream must always reach.
 *
 * Before this existed, a severed response rendered ABSOLUTELY NOTHING while the
 * answer sat persisted server-side (gotcha-61) — the user's only clue was a
 * bubble that quietly stopped growing. Every branch here says something, and
 * the unrecovered branch stays actionable rather than dead-ending.
 *
 * Sits in the assistant gutter and borrows ActionConfirmCard's geometry so the
 * two read as one family.
 */
export function StreamDropNotice({
  state,
  onRetry,
}: {
  state: DropState;
  onRetry: () => void;
}) {
  if (state === "none") return null;

  if (state === "checking") {
    return (
      <p
        aria-live="polite"
        className="text-muted-foreground animate-pulse pl-10 text-xs"
      >
        Reconnecting — checking whether your answer arrived…
      </p>
    );
  }

  if (state === "recovered") {
    return (
      <p
        aria-live="polite"
        className="text-muted-foreground flex items-center gap-1.5 pl-10 text-xs"
      >
        <WifiOff className="size-3.5 shrink-0" aria-hidden />
        Connection dropped — recovered your answer.
      </p>
    );
  }

  return (
    <div className="pl-10">
      <div
        role="group"
        aria-live="polite"
        aria-label="Connection lost"
        className="bg-surface hover:border-border-hover rounded-lg border p-3 text-sm transition-colors"
      >
        <Kicker>Connection lost</Kicker>
        <p className="text-foreground mt-1.5 font-medium">
          The reply didn&apos;t reach your browser.
        </p>
        <p className="text-muted-foreground mt-1 text-xs">
          It may still be finishing on the server — nothing was lost on their
          end. Check again in a moment, or ask again.
        </p>
        {/* No busy state needed: the click flips this to `checking`, which is
            the pulsing line above — the button is gone by then. */}
        <div className="mt-3 flex items-center justify-end">
          <Button size="sm" variant="ghost" onClick={onRetry}>
            <RotateCw className="size-3.5" />
            Check again
          </Button>
        </div>
      </div>
    </div>
  );
}
