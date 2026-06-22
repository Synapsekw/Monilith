import { cn } from "@/lib/utils";
import type { CapacityState } from "@/lib/workload/types";

/** Whole-hour readout for a dense grid cell. */
function hours(secs: number): string {
  return `${Math.round(secs / 3600)}h`;
}

/**
 * One person × one week cell: effort over capacity with a capacity-state color.
 * Color is paired with the numeric text (never color-only) for AA + colorblind
 * safety. State semantics follow pulse-ui: under = muted, at = brand accent,
 * over = destructive; none = no capacity (e.g. the Unassigned row).
 */
export function CapacityCell({
  effortSecs,
  capacitySecs,
  state,
}: {
  effortSecs: number;
  capacitySecs: number;
  state: CapacityState;
}) {
  const empty = effortSecs === 0 && state !== "over";

  return (
    <div
      data-testid="capacity-cell"
      data-state={state}
      className={cn(
        "flex h-9 flex-col items-center justify-center rounded-md px-2 text-center tabular-nums transition-colors",
        empty && "text-muted-foreground/50",
        !empty && state === "under" && "bg-surface-muted text-foreground",
        !empty &&
          state === "at" &&
          "bg-primary/15 text-foreground ring-primary/30 ring-1",
        !empty &&
          state === "over" &&
          "bg-destructive/15 text-destructive ring-destructive/30 ring-1",
        !empty && state === "none" && "bg-surface-muted text-muted-foreground",
      )}
    >
      <span className="text-xs leading-tight font-medium">
        {hours(effortSecs)}
      </span>
      {state === "none" ? null : (
        <span className="text-muted-foreground text-[10px] leading-tight">
          / {hours(capacitySecs)}
        </span>
      )}
    </div>
  );
}
