"use client";

import { useWidgetData } from "@/lib/dashboards/use-widget-data";
import { bucketsTotal, shapeBuckets } from "@/lib/dashboards/widget-data";
import type { CacheWidget } from "@/lib/dashboards/cache";

export function BatteryWidget({ widget }: { widget: CacheWidget }) {
  const config = (widget.config ?? {}) as { groupColumnId?: string };
  const { data, isLoading, isError } = useWidgetData(
    widget.id,
    widget.config as Record<string, unknown>,
  );

  if (!widget.source_board_id || !config.groupColumnId)
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
        Configure a source board and group column
      </div>
    );
  if (isLoading)
    return <div className="bg-muted/40 h-full animate-pulse rounded-md" />;
  if (isError || !data?.columnMeta)
    return <div className="text-destructive text-sm">Failed to load</div>;

  const rows = shapeBuckets(data.buckets, data.columnMeta);
  const total = bucketsTotal(data.buckets);
  if (total === 0)
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
        No data yet
      </div>
    );

  return (
    <div className="flex h-full flex-col justify-center gap-3">
      <div className="flex h-7 w-full overflow-hidden rounded-md">
        {rows
          .filter((r) => r.count > 0)
          .map((r) => (
            <div
              key={r.key ?? "none"}
              className="h-full"
              style={{
                width: `${(r.count / total) * 100}%`,
                backgroundColor: r.color,
              }}
              title={`${r.label}: ${r.count}`}
            />
          ))}
      </div>
      <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {rows
          .filter((r) => r.count > 0)
          .map((r) => (
            <li key={r.key ?? "none"} className="flex items-center gap-1.5">
              <span
                className="size-2.5 rounded-sm"
                style={{ backgroundColor: r.color }}
              />
              <span className="text-muted-foreground">
                {r.label} {Math.round((r.count / total) * 100)}%
              </span>
            </li>
          ))}
      </ul>
    </div>
  );
}
