import { cn } from "@/lib/utils";
import type { PortfolioHealth } from "@/lib/portfolios/types";

const LABEL: Record<PortfolioHealth, string> = {
  on_track: "On track",
  at_risk: "At risk",
  off_track: "Off track",
};
const TONE: Record<PortfolioHealth, string> = {
  on_track: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  at_risk: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  off_track: "bg-red-500/15 text-red-600 dark:text-red-400",
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
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium",
        TONE[health],
      )}
    >
      {LABEL[health]}
      {isAuto ? (
        <span className="opacity-60" title="Auto (from pace)">
          ·auto
        </span>
      ) : null}
    </span>
  );
}
