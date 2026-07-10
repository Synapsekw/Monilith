"use client";

import { useWidgetData } from "@/lib/dashboards/use-widget-data";
import { formatMetric, numberFromBuckets } from "@/lib/dashboards/widget-data";
import type { CacheWidget } from "@/lib/dashboards/cache";
import { Kicker } from "@/components/ui/kicker";

export function NumberWidget({ widget }: { widget: CacheWidget }) {
  const config = (widget.config ?? {}) as {
    agg?: "count" | "sum" | "avg";
    display?: "plain" | "gauge";
    target?: number;
  };
  const agg = config.agg ?? "count";
  const { data, isLoading, isError } = useWidgetData(widget.id);

  if (!widget.source_board_id)
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
        Pick a source board
      </div>
    );
  if (isLoading)
    return <div className="bg-muted/40 h-full animate-pulse rounded-md" />;
  if (isError)
    return <div className="text-destructive text-sm">Failed to load</div>;

  const value = numberFromBuckets(data?.buckets ?? []);

  if (config.display === "gauge" && config.target && config.target > 0) {
    const pct = Math.min(value / config.target, 1);
    const r = 38;
    const circ = 2 * Math.PI * r;
    return (
      <div className="flex h-full items-center justify-center gap-4">
        <svg width="92" height="92" viewBox="0 0 92 92">
          <circle
            cx="46"
            cy="46"
            r={r}
            fill="none"
            stroke="var(--muted)"
            strokeWidth="9"
          />
          <circle
            cx="46"
            cy="46"
            r={r}
            fill="none"
            stroke="var(--brand)"
            strokeWidth="9"
            strokeLinecap="round"
            strokeDasharray={circ}
            strokeDashoffset={circ * (1 - pct)}
            transform="rotate(-90 46 46)"
          />
        </svg>
        <div>
          <div className="text-2xl font-semibold tabular-nums">
            {Math.round(pct * 100)}%
          </div>
          <div className="text-muted-foreground text-xs">
            {formatMetric(value, agg)} / {config.target}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col items-center justify-center">
      <span className="from-foreground to-foreground/60 bg-gradient-to-b bg-clip-text text-4xl font-semibold text-transparent tabular-nums">
        {formatMetric(value, agg)}
      </span>
      <Kicker className="mt-1">{agg === "count" ? "items" : agg}</Kicker>
    </div>
  );
}
