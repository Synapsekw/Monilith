"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  LineChart,
  Pie,
  PieChart,
  RadialBar,
  RadialBarChart,
  XAxis,
  YAxis,
} from "recharts";

import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { buildChartConfig } from "@/components/dashboards/widgets/chart-config";
import { useWidgetSeries } from "@/lib/dashboards/use-widget-series";
import { pivotSeries } from "@/lib/dashboards/series";
import {
  AXIS_PROPS,
  GRID_STROKE,
} from "@/components/dashboards/widgets/chart-theme";
import type { CacheWidget } from "@/lib/dashboards/cache";

const CHART_CLASS = "h-full w-full !aspect-auto";

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
  const chartConfig = buildChartConfig(series);
  const ct = data.chartType;

  // ── circular charts ──
  if (ct === "pie" || ct === "donut") {
    return (
      <ChartContainer config={chartConfig} className={CHART_CLASS}>
        <PieChart>
          <ChartTooltip content={<ChartTooltipContent nameKey="__label" />} />
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
      </ChartContainer>
    );
  }

  if (ct === "radial") {
    return (
      <ChartContainer config={chartConfig} className={CHART_CLASS}>
        <RadialBarChart data={rows} innerRadius="25%" outerRadius="95%">
          <ChartTooltip content={<ChartTooltipContent nameKey="__label" />} />
          <RadialBar dataKey="Value" background>
            {rows.map((r) => (
              <Cell
                key={String(r.__label)}
                fill={String(r[`__color_${r.__label}`] ?? "var(--brand)")}
              />
            ))}
          </RadialBar>
        </RadialBarChart>
      </ChartContainer>
    );
  }

  // ── line / area ──
  if (ct === "line" || ct === "area") {
    const Chart = ct === "line" ? LineChart : AreaChart;
    return (
      <ChartContainer config={chartConfig} className={CHART_CLASS}>
        <Chart data={rows}>
          <CartesianGrid
            stroke={GRID_STROKE}
            strokeDasharray="3 3"
            vertical={false}
          />
          <XAxis dataKey="__label" {...AXIS_PROPS} />
          <YAxis {...AXIS_PROPS} width={32} />
          <ChartTooltip content={<ChartTooltipContent />} />
          {series.length > 1 ? (
            <ChartLegend content={<ChartLegendContent />} />
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
      </ChartContainer>
    );
  }

  // ── combo (bar + line) ──
  if (ct === "combo") {
    const comboMap = (config.comboMap ?? {}) as Record<string, "bar" | "line">;
    return (
      <ChartContainer config={chartConfig} className={CHART_CLASS}>
        <ComposedChart data={rows}>
          <CartesianGrid
            stroke={GRID_STROKE}
            strokeDasharray="3 3"
            vertical={false}
          />
          <XAxis dataKey="__label" {...AXIS_PROPS} />
          <YAxis {...AXIS_PROPS} width={32} />
          <ChartTooltip content={<ChartTooltipContent />} />
          {series.length > 1 ? (
            <ChartLegend content={<ChartLegendContent />} />
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
      </ChartContainer>
    );
  }

  // ── bar family (bar / stackedBar / groupedBar) ──
  const stack = ct === "stackedBar";
  return (
    <ChartContainer config={chartConfig} className={CHART_CLASS}>
      <BarChart data={rows}>
        <CartesianGrid
          stroke={GRID_STROKE}
          strokeDasharray="3 3"
          vertical={false}
        />
        <XAxis dataKey="__label" {...AXIS_PROPS} />
        <YAxis {...AXIS_PROPS} width={32} />
        <ChartTooltip content={<ChartTooltipContent />} />
        {series.length > 1 ? (
          <ChartLegend content={<ChartLegendContent />} />
        ) : null}
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
    </ChartContainer>
  );
}
