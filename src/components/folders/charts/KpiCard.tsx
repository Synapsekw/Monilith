import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Sparkline } from "@/components/folders/charts/Sparkline";
import { Kicker } from "@/components/ui/kicker";
import {
  STATUS_BG,
  StatusPill,
  type StatusColor,
} from "@/components/ui/status-pill";

/**
 * One dense KPI card: value, badge, one sub-fact, then either a trend row
 * (change pill + sparkline) or a thin progress bar.
 *
 * With `action` the whole card is one control that opens the list of items
 * behind its number, in place: a real <button> stretched over the card (the
 * card's content stays ordinary markup, so nothing invalid nests inside a
 * button), a chevron that turns when open, and the bright hairline while it
 * is.
 */
export function KpiCard({
  label,
  value,
  badge,
  subFact,
  progress = null,
  barColor = "blue",
  trend,
  action,
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
  action?: {
    /** What the control does, in words: "Show the 402 overdue items". */
    label: string;
    expanded: boolean;
    /** id of the region the card opens. */
    controls: string;
    onToggle: () => void;
  };
  className?: string;
}) {
  const pct = progress === null ? null : Math.max(0, Math.min(100, progress));
  return (
    <div
      data-testid="kpi-card"
      className={cn(
        "bg-surface hover:border-border-hover relative flex min-w-0 flex-col gap-2 rounded-lg border p-4",
        action?.expanded && "border-border-bright hover:border-border-bright",
        className,
      )}
    >
      {action ? (
        <button
          type="button"
          data-testid="kpi-open"
          aria-label={action.label}
          aria-expanded={action.expanded}
          aria-controls={action.controls}
          onClick={action.onToggle}
          className="focus-visible:ring-ring absolute inset-0 cursor-pointer rounded-lg outline-none focus-visible:ring-2"
        />
      ) : null}
      <div className="flex items-center justify-between gap-2">
        <Kicker data-testid="kpi-label">{label}</Kicker>
        {action ? (
          <ChevronDown
            aria-hidden
            className={cn(
              "text-muted-foreground size-3.5 shrink-0 transition-transform",
              action.expanded && "rotate-180",
            )}
          />
        ) : null}
      </div>
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
        // The pill states the change in words, so it must never be clipped
        // ("+5 pts this wee"). When the card is too narrow for pill and
        // sparkline, the sparkline wraps to the next line; on a card narrower
        // than the pill itself, the pill wraps its words instead of
        // overflowing (StatusPill's `truncate` is cancelled by `text-clip`).
        <div className="flex flex-wrap items-end justify-between gap-2">
          <StatusPill
            color={trend.change.color}
            variant="soft"
            className="max-w-full text-clip whitespace-normal"
          >
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
