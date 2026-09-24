import { cn } from "@/lib/utils";
import { STATUS_BG } from "@/components/ui/status-pill";

export type StatusMix = {
  done: number;
  inProgress: number;
  overdue: number;
  notStarted: number;
};

const SEGMENTS: { key: keyof StatusMix; label: string; bg: string }[] = [
  { key: "done", label: "done", bg: STATUS_BG.green },
  { key: "inProgress", label: "in progress", bg: STATUS_BG.blue },
  { key: "overdue", label: "overdue", bg: STATUS_BG.red },
  { key: "notStarted", label: "not started", bg: STATUS_BG.gray },
];

/** done / in progress / overdue / not started as one 6px track (spec §5.2.3). */
export function StackedStatusBar({
  mix,
  label,
  showCount = false,
  className,
}: {
  mix: StatusMix;
  label?: string;
  showCount?: boolean;
  className?: string;
}) {
  const total = mix.done + mix.inProgress + mix.overdue + mix.notStarted;
  const summary = `${label ? `${label}: ` : ""}${mix.done} done, ${mix.inProgress} in progress, ${mix.overdue} overdue, ${mix.notStarted} not started`;
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div
        role="img"
        aria-label={summary}
        className="bg-surface-muted flex h-1.5 min-w-0 flex-1 overflow-hidden rounded-sm"
      >
        {SEGMENTS.map((s) => (
          <div
            key={s.key}
            data-testid="status-segment"
            className={cn("h-full", s.bg)}
            style={{
              width: total === 0 ? "0%" : `${(mix[s.key] / total) * 100}%`,
            }}
          />
        ))}
      </div>
      {showCount ? (
        <span className="text-muted-foreground font-mono text-xs tabular-nums">
          {total}
        </span>
      ) : null}
    </div>
  );
}
