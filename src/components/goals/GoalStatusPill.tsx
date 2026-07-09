import { StatusPill, type StatusPillColor } from "@/components/ui/status-pill";
import type { GoalHealth, GoalStatus } from "@/lib/goals/types";

const LABEL: Record<GoalStatus, string> = {
  on_track: "On track",
  at_risk: "At risk",
  off_track: "Off track",
  done: "Done",
};
// Status semantics on the sanctioned --status-* palette (was a forked raw
// emerald/amber/red map): on-track=green, at-risk=yellow, off-track=red,
// done=brand accent — matching the boards' status rendering.
const COLOR: Record<GoalStatus, StatusPillColor> = {
  on_track: "green",
  at_risk: "yellow",
  off_track: "red",
  done: "primary",
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
  const showAuto =
    autoHealth !== null && (autoHealth as string) !== (status as string);
  return (
    <StatusPill color={COLOR[status]} variant="soft" className="gap-1">
      {LABEL[status]}
      {showAuto ? (
        <span
          className="opacity-60"
          title={`Auto (from pace): ${AUTO_LABEL[autoHealth]}`}
        >
          ·auto: {AUTO_LABEL[autoHealth]}
        </span>
      ) : null}
    </StatusPill>
  );
}
