"use client";

import { useMemo } from "react";
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
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  ChartLegend,
  formatChartValue,
  type ChartLegendEntry,
} from "@/components/dashboards/widgets/ChartLegend";
import { buildChartConfig } from "@/components/dashboards/widgets/chart-config";
import {
  collectGradients,
  paintFill,
  paintStroke,
  resolveChartColors,
  solidOf,
  type Paint,
} from "@/components/dashboards/widgets/chart-colors";
import { ChartDefs, glowId } from "@/components/dashboards/widgets/ChartDefs";
import { useReducedMotion } from "@/components/dashboards/widgets/use-reduced-motion";
import { CHART_MOTION } from "@/components/dashboards/widgets/chart-theme";
import { useWidgetSeries } from "@/lib/dashboards/use-widget-series";
import { pivotSeries, type PivotRow } from "@/lib/dashboards/series";
import {
  AXIS_PROPS,
  GRID_STROKE,
} from "@/components/dashboards/widgets/chart-theme";
import type { CacheWidget } from "@/lib/dashboards/cache";
import { Kicker } from "@/components/ui/kicker";
import { cn } from "@/lib/utils";

// The chart fills its (relatively positioned) frame cell absolutely, so
// recharts always measures a definite box however the legend is laid out.
const CHART_CLASS = "absolute inset-0 h-full w-full !aspect-auto";

/**
 * Circular marks draw their FINAL geometry on first paint.
 *
 * recharts drives the Pie / RadialBar entrance as a requestAnimationFrame
 * sweep from 0 degrees, keyed on the element's props object — a fresh object
 * on every render — so each re-render of the widget throws the sweep away and
 * starts a new one (and `<Pie>` waits its default 400ms `animationBegin`
 * again first). Any run of re-renders, or a tab that is not being painted,
 * therefore leaves the mark parked part-way round: a wedge in the upper-right
 * quadrant instead of a circle. Cartesian marks key on their computed data and
 * resume, so they are unaffected. The entrance is a CSS fade/scale on the
 * frame instead (`CIRCULAR_ENTER`), which always resolves to the final state.
 */
const CIRCULAR_STATIC = { isAnimationActive: false } as const;
const CIRCULAR_ENTER =
  "animate-in fade-in zoom-in-95 duration-700 ease-out motion-reduce:animate-none";

const num = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : 0);

/** One legend row per slice: its own colour and its value. */
function sliceEntries(
  rows: PivotRow[],
  cells: { label: string; paint: Paint }[],
): ChartLegendEntry[] {
  return cells.map((c, i) => ({
    key: c.label,
    label: c.label,
    color: solidOf(c.paint),
    value: num(rows[i]?.Value),
  }));
}

/** One legend row per series: its colour and its total across the axis. */
function seriesEntries(
  rows: PivotRow[],
  series: { key: string; paint: Paint }[],
): ChartLegendEntry[] {
  return series.map((s) => ({
    key: s.key,
    label: s.key,
    color: solidOf(s.paint),
    value: rows.reduce((sum, r) => sum + num(r[s.key]), 0),
  }));
}

/**
 * Chart + legend layout. The frame is a size container, so the legend can
 * yield to the mark purely in CSS: under the chart by default, beside it when
 * the widget is wide (`side`), and gone when the widget is too short.
 */
function ChartFrame({
  legend,
  side = false,
  enter,
  overlay,
  children,
}: {
  legend: ChartLegendEntry[] | null;
  side?: boolean;
  enter?: string;
  /** Painted UNDER the chart (e.g. the donut total, seen through the hole). */
  overlay?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="[container-type:size] h-full w-full">
      <div
        className={cn(
          "flex h-full w-full flex-col gap-2",
          side && "@md:flex-row @md:gap-4",
        )}
      >
        <div
          data-slot="chart-plot"
          className={cn(
            "[container-type:size] relative min-h-0 min-w-0 flex-1",
            enter,
          )}
        >
          {overlay}
          {children}
        </div>
        {legend ? (
          <ChartLegend entries={legend} placement={side ? "auto" : "bottom"} />
        ) : null}
      </div>
    </div>
  );
}

/** Grand total, centred in the donut's hole (55% of the shorter side). */
function DonutTotal({ total }: { total: number }) {
  return (
    <div
      data-testid="chart-total"
      className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center leading-none"
    >
      <span className="text-foreground font-heading text-[clamp(0.625rem,13cqmin,1.75rem)] font-semibold tracking-tight tabular-nums">
        {formatChartValue(total)}
      </span>
      <Kicker className="mt-1 hidden text-[clamp(0.5rem,5cqmin,0.6875rem)] [@container_(min-height:7rem)]:block">
        Total
      </Kicker>
    </div>
  );
}

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
  // Pivot once per payload: recharts keys its cartesian animations on the
  // identity of the data it is handed, so re-pivoting on every render restarts
  // them for no reason.
  const pivoted = useMemo(() => (data ? pivotSeries(data) : null), [data]);

  if (!widget.source_board_id) return <Empty>Pick a source board</Empty>;
  if (isLoading)
    return <div className="bg-muted/40 h-full animate-pulse rounded-md" />;
  if (isError || !data || !pivoted) return <Empty>Failed to load</Empty>;
  if (data.points.length === 0) return <Empty>No data yet</Empty>;

  const { rows, series } = pivoted;
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
  const seriesLegend =
    series.length > 1 ? seriesEntries(rows, colors.series) : null;

  // ── circular charts ── (per-cell colors from resolver.cells)
  if (ct === "pie" || ct === "donut") {
    const cells = colors.cells ?? [];
    const legend = sliceEntries(rows, cells);
    return (
      <ChartFrame
        legend={legend}
        side
        enter={CIRCULAR_ENTER}
        overlay={
          ct === "donut" ? (
            <DonutTotal total={legend.reduce((t, e) => t + e.value, 0)} />
          ) : null
        }
      >
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
              {...CIRCULAR_STATIC}
            >
              {cells.map((c) => (
                <Cell key={c.label} fill={paintFill(wid, c.paint, "bar")} />
              ))}
            </Pie>
          </PieChart>
        </ChartContainer>
      </ChartFrame>
    );
  }

  if (ct === "radial") {
    const cells = colors.cells ?? [];
    return (
      <ChartFrame
        legend={sliceEntries(rows, cells)}
        side
        enter={CIRCULAR_ENTER}
      >
        <ChartContainer config={chartConfig} className={CHART_CLASS}>
          <RadialBarChart data={rows} innerRadius="25%" outerRadius="95%">
            <ChartDefs widgetId={wid} specs={gradients} />
            <ChartTooltip content={<ChartTooltipContent nameKey="__label" />} />
            <RadialBar dataKey="Value" background {...CIRCULAR_STATIC}>
              {cells.map((c) => (
                <Cell key={c.label} fill={paintFill(wid, c.paint, "bar")} />
              ))}
            </RadialBar>
          </RadialBarChart>
        </ChartContainer>
      </ChartFrame>
    );
  }

  // ── line / area ──
  if (ct === "line" || ct === "area") {
    const Chart = ct === "line" ? LineChart : AreaChart;
    return (
      <ChartFrame legend={seriesLegend}>
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
      </ChartFrame>
    );
  }

  // ── combo (bar + line) ──
  if (ct === "combo") {
    const comboMap = (config.comboMap ?? {}) as Record<string, "bar" | "line">;
    return (
      <ChartFrame legend={seriesLegend}>
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
      </ChartFrame>
    );
  }

  // ── bar family (bar / stackedBar / groupedBar) ──
  const stack = ct === "stackedBar";
  return (
    <ChartFrame legend={seriesLegend}>
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
                      <Cell
                        key={c.label}
                        fill={paintFill(wid, c.paint, "bar")}
                      />
                    ))
                  : null}
              </Bar>
            );
          })}
        </BarChart>
      </ChartContainer>
    </ChartFrame>
  );
}
