import { cn } from "@/lib/utils";
import type { GoalHealth, GoalStatus } from "@/lib/goals/types";

const LABEL: Record<GoalStatus, string> = {
  on_track: "On track",
  at_risk: "At risk",
  off_track: "Off track",
  done: "Done",
};
const TONE: Record<GoalStatus, string> = {
  on_track: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  at_risk: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  off_track: "bg-red-500/15 text-red-600 dark:text-red-400",
  done: "bg-primary/15 text-primary",
};
const AUTO_LABEL: Record<GoalHealth, string> = {
  on_track: "on track",
  at_risk: "at risk",
  off_track: "off track",
};

/**
 * The manual `status` is authoritative and shown as the pill. When the
 * pace-derived `autoHealth` disagrees, surface it as a muted `·auto` hint.
 */
export function GoalStatusPill({
  status,
  autoHealth,
}: {
  status: GoalStatus;
  autoHealth: GoalHealth | null;
}) {
  const showAuto = autoHealth !== null && (autoHealth as string) !== (status as string);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium",
        TONE[status],
      )}
    >
      {LABEL[status]}
      {showAuto ? (
        <span className="opacity-60" title={`Auto (from pace): ${AUTO_LABEL[autoHealth]}`}>
          ·auto: {AUTO_LABEL[autoHealth]}
        </span>
      ) : null}
    </span>
  );
}
