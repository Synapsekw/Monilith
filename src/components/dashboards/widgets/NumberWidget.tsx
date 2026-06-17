"use client";

import { useWidgetData } from "@/lib/dashboards/use-widget-data";
import { formatMetric, numberFromBuckets } from "@/lib/dashboards/widget-data";
import type { CacheWidget } from "@/lib/dashboards/cache";

export function NumberWidget({ widget }: { widget: CacheWidget }) {
  const config = (widget.config ?? {}) as { agg?: "count" | "sum" | "avg" };
  const agg = config.agg ?? "count";
  const { data, isLoading, isError } = useWidgetData(
    widget.id,
    widget.config as Record<string, unknown>,
  );

  if (!widget.source_board_id) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
        Pick a source board
      </div>
    );
  }
  if (isLoading)
    return <div className="bg-muted/40 h-full animate-pulse rounded-md" />;
  if (isError)
    return <div className="text-destructive text-sm">Failed to load</div>;

  const value = numberFromBuckets(data?.buckets ?? []);
  return (
    <div className="flex h-full flex-col items-center justify-center">
      <span className="text-4xl font-semibold tabular-nums">
        {formatMetric(value, agg)}
      </span>
      <span className="text-muted-foreground mt-1 text-xs tracking-wide uppercase">
        {agg === "count" ? "items" : agg}
      </span>
    </div>
  );
}
