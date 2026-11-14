import { cn } from "@/lib/utils";
import { Sparkline } from "@/components/folders/charts/Sparkline";
import { Kicker } from "@/components/ui/kicker";
import {
  STATUS_BG,
  StatusPill,
  type StatusColor,
} from "@/components/ui/status-pill";

/** One dense KPI card: value, badge, one sub-fact, then either a trend row (change pill + sparkline) or a thin progress bar. */
export function KpiCard({
  label,
  value,
  badge,
  subFact,
  progress = null,
  barColor = "blue",
  trend,
  className,
}: {
  label: string;
  value: string;
  badge?: { text: string; color: StatusColor };
  subFact?: string;
  progress?: number | null;
  barColor?: StatusColor;
  trend?: {
    points: number[];
    kind: "line" | "bars";
    color: StatusColor;
    label: string;
    change: { text: string; color: StatusColor };
  };
  className?: string;
}) {
  const pct = progress === null ? null : Math.max(0, Math.min(100, progress));
  return (
    <div
      className={cn(
        "bg-surface hover:border-border-hover flex flex-col gap-2 rounded-lg border p-4",
        className,
      )}
    >
      <Kicker data-testid="kpi-label">{label}</Kicker>
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-heading text-2xl font-semibold tracking-tight tabular-nums">
          {value}
        </span>
        {badge ? (
          <StatusPill color={badge.color} variant="soft">
            {badge.text}
          </StatusPill>
        ) : null}
      </div>
      {subFact ? (
        <p className="text-muted-foreground text-xs">{subFact}</p>
      ) : null}
      {trend ? (
        <div className="flex items-end justify-between gap-2">
          <StatusPill color={trend.change.color} variant="soft">
            {trend.change.text}
          </StatusPill>
          <Sparkline
            points={trend.points}
            kind={trend.kind}
            color={trend.color}
            label={trend.label}
          />
        </div>
      ) : pct === null ? null : (
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-label={label}
          className="bg-surface-muted h-1 w-full overflow-hidden rounded-sm"
        >
          <div
            className={cn("h-full rounded-sm", STATUS_BG[barColor])}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}
