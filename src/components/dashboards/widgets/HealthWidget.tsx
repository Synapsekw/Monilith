"use client";

import { useWidgetData } from "@/lib/dashboards/use-widget-data";
import { shapeHealth } from "@/lib/dashboards/widget-data";
import { percentBandColor } from "@/lib/boards/percent-color";
import { cn } from "@/lib/utils";
import type { CacheWidget } from "@/lib/dashboards/cache";

/**
 * Health summary widget: overall progress (% of top-level items done) plus
 * overdue / structurally-incomplete / new-this-week counts for the source
 * board. Zero config; rule semantics match the board's overdue tint
 * (src/lib/boards/overdue.ts). Chrome is monochrome; text-destructive marks
 * only nonzero alert counts and is always paired with the row label (AA).
 * Plain DOM (no recharts), statically imported like BatteryWidget.
 */
export function HealthWidget({ widget }: { widget: CacheWidget }) {
  const { data, isLoading, isError } = useWidgetData(widget.id);

  if (!widget.source_board_id)
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
        Configure a source board
      </div>
    );
  if (isLoading)
    return <div className="bg-muted/40 h-full animate-pulse rounded-md" />;
  if (isError || !data?.health)
    return <div className="text-destructive text-sm">Failed to load</div>;

  const shaped = shapeHealth(data.health);
  if (shaped.progress === null)
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
        No data yet
      </div>
    );

  const rows: { label: string; value: number; alert: boolean }[] = [
    { label: "New this week", value: shaped.counts.newItems7d, alert: false },
    { label: "Overdue", value: shaped.counts.overdueItems, alert: true },
    { label: "Incomplete", value: shaped.counts.incompleteItems, alert: true },
  ];

  return (
    <div className="flex h-full flex-col gap-3">
      <div>
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-semibold tabular-nums">
            {Math.round(shaped.progress)}%
          </span>
          <span className="text-muted-foreground text-xs">
            done · {shaped.counts.totalItems}{" "}
            {shaped.counts.totalItems === 1 ? "item" : "items"}
          </span>
        </div>
        <span className="bg-muted mt-2 block h-2 overflow-hidden rounded-full">
          <span
            className={`block h-full rounded-full ${percentBandColor(shaped.progress)}`}
            style={{
              width: `${Math.min(Math.max(shaped.progress, 0), 100)}%`,
            }}
          />
        </span>
      </div>
      <ul className="flex min-h-0 flex-1 flex-col justify-end gap-1.5">
        {rows.map((r) => (
          <li
            key={r.label}
            className="flex items-center justify-between border-t pt-1.5 text-xs first:border-t-0"
          >
            <span className="text-muted-foreground">{r.label}</span>
            <span
              className={cn(
                "font-medium tabular-nums",
                r.alert && r.value > 0 && "text-destructive",
              )}
            >
              {r.value}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
