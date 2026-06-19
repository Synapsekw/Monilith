"use client";

import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
} from "recharts";

import { useWidgetData } from "@/lib/dashboards/use-widget-data";
import { shapeBuckets } from "@/lib/dashboards/widget-data";
import type { CacheWidget } from "@/lib/dashboards/cache";

export function ChartWidget({ widget }: { widget: CacheWidget }) {
  const config = (widget.config ?? {}) as {
    groupColumnId?: string;
    chartStyle?: "bar" | "pie";
  };
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

  const rows = shapeBuckets(data.buckets, data.columnMeta).filter(
    (r) => r.count > 0,
  );
  if (rows.length === 0)
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
        No data yet
      </div>
    );

  return (
    <ResponsiveContainer width="100%" height="100%">
      {config.chartStyle === "pie" ? (
        <PieChart>
          <Tooltip />
          <Pie
            data={rows}
            dataKey="count"
            nameKey="label"
            innerRadius="45%"
            outerRadius="80%"
          >
            {rows.map((r) => (
              <Cell key={r.key ?? "none"} fill={r.color} />
            ))}
          </Pie>
        </PieChart>
      ) : (
        <BarChart data={rows}>
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11 }}
            stroke="var(--muted-foreground)"
          />
          <Tooltip cursor={{ fill: "var(--muted)" }} />
          <Bar dataKey="count" radius={[4, 4, 0, 0]}>
            {rows.map((r) => (
              <Cell key={r.key ?? "none"} fill={r.color} />
            ))}
          </Bar>
        </BarChart>
      )}
    </ResponsiveContainer>
  );
}
