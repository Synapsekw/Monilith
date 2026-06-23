import { cn } from "@/lib/utils";
import { capacityState } from "@/lib/workload/rollup";
import type { CapacityState, WorkloadMetric } from "@/lib/workload/types";

/** Whole-hour readout for a dense grid cell. */
function hours(secs: number): string {
  return `${Math.round(secs / 3600)}h`;
}

/**
 * One person × one week cell. Shows planned effort, logged actuals, or both,
 * over capacity, with a capacity-state color. Color is paired with the numeric
 * text (never color-only) for AA + colorblind safety. State semantics follow
 * pulse-ui: under = muted, at = brand accent, over = destructive; none = no
 * capacity (e.g. the Unassigned row). In `actual` mode the color reflects
 * actuals-vs-capacity; in `planned`/`both` it reflects planned-vs-capacity.
 */
export function CapacityCell({
  effortSecs,
  capacitySecs,
  actualSecs = 0,
  state,
  metric = "planned",
}: {
  effortSecs: number;
  capacitySecs: number;
  actualSecs?: number;
  state: CapacityState;
  metric?: WorkloadMetric;
}) {
  const displayState: CapacityState =
    metric === "actual" ? capacityState(actualSecs, capacitySecs) : state;
  const primarySecs = metric === "actual" ? actualSecs : effortSecs;
  const empty = primarySecs === 0 && displayState !== "over";

  return (
    <div
      data-testid="capacity-cell"
      data-state={displayState}
      data-metric={metric}
      className={cn(
        "flex h-9 flex-col items-center justify-center rounded-md px-2 text-center tabular-nums transition-colors",
        empty && "text-muted-foreground/50",
        !empty &&
          displayState === "under" &&
          "bg-surface-muted text-foreground",
        !empty &&
          displayState === "at" &&
          "bg-primary/15 text-foreground ring-primary/30 ring-1",
        !empty &&
          displayState === "over" &&
          "bg-destructive/15 text-destructive ring-destructive/30 ring-1",
        !empty &&
          displayState === "none" &&
          "bg-surface-muted text-muted-foreground",
      )}
    >
      <span className="text-xs leading-tight font-medium">
        {hours(primarySecs)}
      </span>
      {metric === "both" ? (
        <span className="text-muted-foreground text-[10px] leading-tight">
          act {hours(actualSecs)}
        </span>
      ) : displayState === "none" ? null : (
        <span className="text-muted-foreground text-[10px] leading-tight">
          / {hours(capacitySecs)}
        </span>
      )}
    </div>
  );
}
