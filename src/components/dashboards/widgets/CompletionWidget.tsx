"use client";

import { useWidgetData } from "@/lib/dashboards/use-widget-data";
import { shapeCompletion } from "@/lib/dashboards/widget-data";
import { percentBandColor } from "@/lib/boards/percent-color";
import type { CacheWidget } from "@/lib/dashboards/cache";

/**
 * Completion widget: overall % complete for the source board plus a per-group
 * (workstream) breakdown. Color is redundant with the numeric labels (AA rule);
 * bar fills reuse the board percent column's red→green band ramp so completion
 * reads identically app-wide. Groups with no top-level items render "—" and are
 * excluded from the overall. Plain DOM (no recharts) — statically imported so
 * it stays out of the lazy chart chunk, like BatteryWidget.
 */
export function CompletionWidget({ widget }: { widget: CacheWidget }) {
  const config = (widget.config ?? {}) as {
    mode?: string;
    percentColumnId?: string;
    statusColumnId?: string;
  };
  const configured =
    config.mode === "percent"
      ? !!config.percentColumnId
      : !!config.statusColumnId;
  const { data, isLoading, isError } = useWidgetData(widget.id);

  if (!widget.source_board_id || !configured)
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
        Configure a source board and completion source
      </div>
    );
  if (isLoading)
    return <div className="bg-muted/40 h-full animate-pulse rounded-md" />;
  if (isError || !data?.completion)
    return <div className="text-destructive text-sm">Failed to load</div>;

  const shaped = shapeCompletion(data.completion.rows, data.completion.groups);
  if (shaped.overall === null)
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
        No data yet
      </div>
    );

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-semibold tabular-nums">
          {Math.round(shaped.overall)}%
        </span>
        <span className="text-muted-foreground text-xs">
          Overall · {shaped.totalItems}{" "}
          {shaped.totalItems === 1 ? "item" : "items"}
        </span>
      </div>
      <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        {shaped.rows.map((r) => (
          <li key={r.key} className="flex items-center gap-2 text-xs">
            <span
              className="size-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: r.color }}
              aria-hidden
            />
            <span className="w-28 shrink-0 truncate" title={r.label}>
              {r.label}
            </span>
            <span className="bg-muted h-2 min-w-0 flex-1 overflow-hidden rounded-full">
              {r.percent !== null ? (
                <span
                  className={`block h-full rounded-full ${percentBandColor(r.percent)}`}
                  style={{ width: `${Math.min(Math.max(r.percent, 0), 100)}%` }}
                />
              ) : null}
            </span>
            <span className="text-muted-foreground w-9 shrink-0 text-right tabular-nums">
              {r.percent === null ? "—" : `${Math.round(r.percent)}%`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
