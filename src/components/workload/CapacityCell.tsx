import { cn } from "@/lib/utils";
import {
  capacityState,
  hours,
  signedHours,
  signedPct,
  variancePct,
  varianceSecs,
  varianceState,
} from "@/lib/workload/rollup";
import type { CapacityState, WorkloadMetric } from "@/lib/workload/types";

/** Map a variance state onto the existing cell color states: over/under keep
 * their visuals; "on" (within band) and "none" read as a neutral surface. */
function varianceColorState(
  actualSecs: number,
  plannedSecs: number,
): CapacityState {
  const v = varianceState(actualSecs, plannedSecs);
  if (v === "over") return "over";
  if (v === "under") return "under";
  return "none";
}

/**
 * One person × one week cell. Shows planned effort, logged actuals, both, or the
 * planned-vs-actual variance, over capacity, with a capacity-state color. Color
 * is paired with the numeric text (never color-only) for AA + colorblind safety.
 * State semantics follow pulse-ui: under = muted, at = brand accent, over =
 * destructive; none = no capacity (e.g. the Unassigned row). In `actual` mode the
 * color reflects actuals-vs-capacity; in `planned`/`both` it reflects
 * planned-vs-capacity; in `variance` it reflects actuals-vs-planned.
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
  if (metric === "variance") {
    const delta = varianceSecs(actualSecs, effortSecs);
    const pct = variancePct(actualSecs, effortSecs);
    const vState = varianceColorState(actualSecs, effortSecs);
    const empty = delta === 0 && vState === "none";
    return (
      <div
        data-testid="capacity-cell"
        data-state={vState}
        data-metric="variance"
        className={cn(
          "flex h-9 flex-col items-center justify-center rounded-md px-2 text-center tabular-nums transition-colors",
          empty && "text-muted-foreground/50",
          !empty && vState === "under" && "bg-surface-muted text-foreground",
          !empty &&
            vState === "over" &&
            "bg-destructive/15 text-destructive ring-destructive/30 ring-1",
          !empty &&
            vState === "none" &&
            "bg-surface-muted text-muted-foreground",
        )}
      >
        <span className="text-xs leading-tight font-medium">
          {signedHours(delta)}
        </span>
        <span className="text-muted-foreground text-[10px] leading-tight">
          {signedPct(pct)}
        </span>
      </div>
    );
  }

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
      {displayState !== "none" ? (
        <div
          data-testid="capacity-bar"
          aria-hidden
          className="bg-border/60 mt-1 h-1 w-full overflow-hidden rounded-full"
        >
          <div
            className={cn(
              "h-full rounded-full transition-[width]",
              displayState === "under" && "bg-foreground/40",
              displayState === "at" && "bg-primary",
              displayState === "over" && "bg-destructive",
            )}
            style={{
              width: `${Math.min(
                100,
                capacitySecs > 0
                  ? Math.round((primarySecs / capacitySecs) * 100)
                  : 0,
              )}%`,
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
