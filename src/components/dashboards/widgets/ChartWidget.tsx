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
import {
  collectGradients,
  paintFill,
  paintStroke,
  resolveChartColors,
  solidOf,
} from "@/components/dashboards/widgets/chart-colors";
import { ChartDefs, glowId } from "@/components/dashboards/widgets/ChartDefs";
import { useReducedMotion } from "@/components/dashboards/widgets/use-reduced-motion";
import { CHART_MOTION } from "@/components/dashboards/widgets/chart-theme";
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
  const reduced = useReducedMotion();
  const { data, isLoading, isError } = useWidgetSeries(widget.id);

  if (!widget.source_board_id) return <Empty>Pick a source board</Empty>;
  if (isLoading)
    return <div className="bg-muted/40 h-full animate-pulse rounded-md" />;
  if (isError || !data) return <Empty>Failed to load</Empty>;
  if (data.points.length === 0) return <Empty>No data yet</Empty>;

  const { rows, series } = pivotSeries(data);
  const ct = data.chartType;
  const wid = widget.id;
  const colors = resolveChartColors({ chartType: ct, rows, series });
  const gradients = collectGradients(wid, colors);
  const chartConfig = buildChartConfig(
    colors.series.map((s) => ({ key: s.key, color: solidOf(s.paint) })),
  );
  const anim = {
    isAnimationActive: !reduced,
    animationDuration: CHART_MOTION.durationMs,
    animationEasing: "ease-out" as const,
  };
  const glow = { filter: `url(#${glowId(wid)})` };

  // ── circular charts ── (per-cell colors from resolver.cells)
  if (ct === "pie" || ct === "donut") {
    const cells = colors.cells ?? [];
    return (
      <ChartContainer config={chartConfig} className={CHART_CLASS}>
        <PieChart>
          <ChartDefs widgetId={wid} specs={gradients} />
          <ChartTooltip content={<ChartTooltipContent nameKey="__label" />} />
          <Pie
            data={rows}
            dataKey="Value"
            nameKey="__label"
            innerRadius={ct === "donut" ? "55%" : 0}
            outerRadius="80%"
            {...anim}
          >
            {cells.map((c) => (
              <Cell key={c.label} fill={paintFill(wid, c.paint, "bar")} />
            ))}
          </Pie>
        </PieChart>
      </ChartContainer>
    );
  }

  if (ct === "radial") {
    const cells = colors.cells ?? [];
    return (
      <ChartContainer config={chartConfig} className={CHART_CLASS}>
        <RadialBarChart data={rows} innerRadius="25%" outerRadius="95%">
          <ChartDefs widgetId={wid} specs={gradients} />
          <ChartTooltip content={<ChartTooltipContent nameKey="__label" />} />
          <RadialBar dataKey="Value" background {...anim}>
            {cells.map((c) => (
              <Cell key={c.label} fill={paintFill(wid, c.paint, "bar")} />
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
          <ChartDefs widgetId={wid} specs={gradients} />
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
          {colors.series.map((s, i) => {
            const begin = i * CHART_MOTION.staggerMs;
            return ct === "line" ? (
              <Line
                key={s.key}
                dataKey={s.key}
                stroke={paintStroke(wid, s.paint)}
                strokeWidth={2.5}
                dot={false}
                activeDot={{ r: 4, style: glow }}
                animationBegin={begin}
                {...anim}
              />
            ) : (
              <Area
                key={s.key}
                dataKey={s.key}
                stroke={paintStroke(wid, s.paint)}
                fill={paintFill(wid, s.paint, "area")}
                strokeWidth={2}
                activeDot={{ r: 4, style: glow }}
                animationBegin={begin}
                {...anim}
              />
            );
          })}
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
          <ChartDefs widgetId={wid} specs={gradients} />
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
          {colors.series.map((s, i) => {
            const begin = i * CHART_MOTION.staggerMs;
            const asBar =
              (comboMap[s.key] ?? (i === 0 ? "bar" : "line")) === "bar";
            return asBar ? (
              <Bar
                key={s.key}
                dataKey={s.key}
                fill={paintFill(wid, s.paint, "bar")}
                radius={[4, 4, 0, 0]}
                animationBegin={begin}
                {...anim}
              />
            ) : (
              <Line
                key={s.key}
                dataKey={s.key}
                stroke={paintStroke(wid, s.paint)}
                strokeWidth={2.5}
                dot={false}
                activeDot={{ r: 4, style: glow }}
                animationBegin={begin}
                {...anim}
              />
            );
          })}
        </ComposedChart>
      </ChartContainer>
    );
  }

  // ── bar family (bar / stackedBar / groupedBar) ──
  const stack = ct === "stackedBar";
  return (
    <ChartContainer config={chartConfig} className={CHART_CLASS}>
      <BarChart data={rows}>
        <ChartDefs widgetId={wid} specs={gradients} />
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
        {colors.series.map((s, i) => {
          return (
            <Bar
              key={s.key}
              dataKey={s.key}
              stackId={stack ? "a" : undefined}
              fill={paintFill(wid, s.paint, "bar")}
              radius={stack ? undefined : [4, 4, 0, 0]}
              animationBegin={i * CHART_MOTION.staggerMs}
              {...anim}
            >
              {colors.cells
                ? colors.cells.map((c) => (
                    <Cell key={c.label} fill={paintFill(wid, c.paint, "bar")} />
                  ))
                : null}
            </Bar>
          );
        })}
      </BarChart>
    </ChartContainer>
  );
}
