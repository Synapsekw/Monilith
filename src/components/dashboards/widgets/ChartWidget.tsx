"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  RadialBar,
  RadialBarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { useWidgetSeries } from "@/lib/dashboards/use-widget-series";
import { pivotSeries } from "@/lib/dashboards/series";
import {
  AXIS_PROPS,
  GRID_STROKE,
  TOOLTIP_STYLE,
} from "@/components/dashboards/widgets/chart-theme";
import type { CacheWidget } from "@/lib/dashboards/cache";

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-muted-foreground flex h-full items-center justify-center text-center text-sm">
      {children}
    </div>
  );
}

export function ChartWidget({ widget }: { widget: CacheWidget }) {
  const config = (widget.config ?? {}) as Record<string, unknown>;
  const { data, isLoading, isError } = useWidgetSeries(widget.id);

  if (!widget.source_board_id) return <Empty>Pick a source board</Empty>;
  if (isLoading)
    return <div className="bg-muted/40 h-full animate-pulse rounded-md" />;
  if (isError || !data) return <Empty>Failed to load</Empty>;
  if (data.points.length === 0) return <Empty>No data yet</Empty>;

  const { rows, series } = pivotSeries(data);
  const ct = data.chartType;

  // ── circular charts ──
  if (ct === "pie" || ct === "donut") {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Tooltip {...TOOLTIP_STYLE} />
          <Pie
            data={rows}
            dataKey="Value"
            nameKey="__label"
            innerRadius={ct === "donut" ? "55%" : 0}
            outerRadius="80%"
          >
            {rows.map((r) => (
              <Cell
                key={String(r.__label)}
                fill={String(r[`__color_${r.__label}`] ?? "var(--brand)")}
              />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
    );
  }

  if (ct === "radial") {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <RadialBarChart data={rows} innerRadius="25%" outerRadius="95%">
          <Tooltip {...TOOLTIP_STYLE} />
          <RadialBar dataKey="Value" background>
            {rows.map((r) => (
              <Cell
                key={String(r.__label)}
                fill={String(r[`__color_${r.__label}`] ?? "var(--brand)")}
              />
            ))}
          </RadialBar>
        </RadialBarChart>
      </ResponsiveContainer>
    );
  }

  // ── line / area ──
  if (ct === "line" || ct === "area") {
    const Chart = ct === "line" ? LineChart : AreaChart;
    return (
      <ResponsiveContainer width="100%" height="100%">
        <Chart data={rows}>
          <CartesianGrid
            stroke={GRID_STROKE}
            strokeDasharray="3 3"
            vertical={false}
          />
          <XAxis dataKey="__label" {...AXIS_PROPS} />
          <YAxis {...AXIS_PROPS} width={32} />
          <Tooltip {...TOOLTIP_STYLE} />
          {series.length > 1 ? (
            <Legend wrapperStyle={{ fontSize: 11 }} />
          ) : null}
          {series.map((s) =>
            ct === "line" ? (
              <Line
                key={s.key}
                dataKey={s.key}
                stroke={s.color}
                strokeWidth={2}
                dot={false}
              />
            ) : (
              <Area
                key={s.key}
                dataKey={s.key}
                stroke={s.color}
                fill={s.color}
                fillOpacity={0.2}
              />
            ),
          )}
        </Chart>
      </ResponsiveContainer>
    );
  }

  // ── combo (bar + line) ──
  if (ct === "combo") {
    const comboMap = (config.comboMap ?? {}) as Record<string, "bar" | "line">;
    return (
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows}>
          <CartesianGrid
            stroke={GRID_STROKE}
            strokeDasharray="3 3"
            vertical={false}
          />
          <XAxis dataKey="__label" {...AXIS_PROPS} />
          <YAxis {...AXIS_PROPS} width={32} />
          <Tooltip {...TOOLTIP_STYLE} />
          {series.length > 1 ? (
            <Legend wrapperStyle={{ fontSize: 11 }} />
          ) : null}
          {series.map((s, i) =>
            (comboMap[s.key] ?? (i === 0 ? "bar" : "line")) === "bar" ? (
              <Bar
                key={s.key}
                dataKey={s.key}
                fill={s.color}
                radius={[4, 4, 0, 0]}
              />
            ) : (
              <Line
                key={s.key}
                dataKey={s.key}
                stroke={s.color}
                strokeWidth={2}
                dot={false}
              />
            ),
          )}
        </ComposedChart>
      </ResponsiveContainer>
    );
  }

  // ── bar family (bar / stackedBar / groupedBar) ──
  const stack = ct === "stackedBar";
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={rows}>
        <CartesianGrid
          stroke={GRID_STROKE}
          strokeDasharray="3 3"
          vertical={false}
        />
        <XAxis dataKey="__label" {...AXIS_PROPS} />
        <YAxis {...AXIS_PROPS} width={32} />
        <Tooltip {...TOOLTIP_STYLE} />
        {series.length > 1 ? <Legend wrapperStyle={{ fontSize: 11 }} /> : null}
        {series.map((s) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            stackId={stack ? "a" : undefined}
            fill={s.color}
            radius={stack ? undefined : [4, 4, 0, 0]}
          >
            {series.length === 1
              ? rows.map((r) => (
                  <Cell
                    key={String(r.__label)}
                    fill={String(r[`__color_${r.__label}`] ?? s.color)}
                  />
                ))
              : null}
          </Bar>
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
