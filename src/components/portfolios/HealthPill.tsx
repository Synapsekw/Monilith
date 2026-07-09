import { StatusPill, type StatusPillColor } from "@/components/ui/status-pill";
import type { PortfolioHealth } from "@/lib/portfolios/types";

const LABEL: Record<PortfolioHealth, string> = {
  on_track: "On track",
  at_risk: "At risk",
  off_track: "Off track",
};
// On the sanctioned --status-* palette (was a forked raw emerald/amber/red
// map): on-track=green, at-risk=yellow, off-track=red.
const COLOR: Record<PortfolioHealth, StatusPillColor> = {
  on_track: "green",
  at_risk: "yellow",
  off_track: "red",
};

export function HealthPill({
  health,
  isAuto,
}: {
  health: PortfolioHealth | null;
  isAuto: boolean;
}) {
  if (!health) return <span className="text-muted-foreground text-xs">—</span>;
  return (
    <StatusPill color={COLOR[health]} variant="soft" className="gap-1">
      {LABEL[health]}
      {isAuto ? (
        <span className="opacity-60" title="Auto (from pace)">
          ·auto
        </span>
      ) : null}
    </StatusPill>
  );
}
