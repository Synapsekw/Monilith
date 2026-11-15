"use client";

import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type { BurnPoint } from "@/lib/folders/rollup";
import { cn } from "@/lib/utils";
import { burnAxisTick, burnAxisWidth } from "./burn-axis";

export type BurnMode = "cumulative" | "weekly";

const CONFIG = {
  planned: { label: "Planned", color: "var(--muted-foreground)" },
  completed: { label: "Completed", color: "var(--primary)" },
  gap: { label: "Behind plan", color: "var(--status-red)" },
  forecast: { label: "Forecast", color: "var(--primary)" },
} satisfies ChartConfig;

function weekLabel(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * Planned vs completed (spec §5.2.2). Cumulative: dashed planned line, accent
 * completed area, red wedge for plannedCum − completedCum on past weeks, a
 * dotted forecast line from today when one is supplied, and a
 * dashed red "Today" marker on the last past week. Weekly: paired bars.
 * Pure — the parent owns the mode toggle (client state, 0 round-trips).
 */
export function BurnChartInner({
  points,
  mode,
  forecast,
  className,
}: {
  points: BurnPoint[];
  mode: BurnMode;
  forecast?: { weekStart: string; value: number }[];
  className?: string;
}) {
  const todayWeek = [...points].reverse().find((p) => p.isPast)?.weekStart;
  const forecastByWeek = new Map(
    (mode === "cumulative" ? (forecast ?? []) : []).map((f) => [
      f.weekStart,
      f.value,
    ]),
  );
  const data = points.map((p) => ({
    week: p.weekStart,
    planned: mode === "cumulative" ? p.plannedCum : p.planned,
    completed: mode === "cumulative" ? p.completedCum : p.completed,
    gap:
      mode === "cumulative" && p.isPast
        ? Math.max(0, p.plannedCum - p.completedCum)
        : 0,
    gapBase: mode === "cumulative" && p.isPast ? p.completedCum : 0,
    forecast: forecastByWeek.get(p.weekStart) ?? null,
  }));
  // Size the Y axis to its longest tick label (four digits used to clip).
  const yMax = Math.max(
    0,
    ...data.map((d) =>
      Math.max(d.planned, d.completed, d.gap + d.gapBase, d.forecast ?? 0),
    ),
  );
  return (
    <ChartContainer
      config={CONFIG}
      className={cn("h-64 w-full", className)}
      initialDimension={{ width: 640, height: 256 }}
    >
      <ComposedChart
        data={data}
        margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
      >
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="week"
          tickFormatter={weekLabel}
          tickLine={false}
          axisLine={false}
          minTickGap={24}
        />
        <YAxis
          allowDecimals={false}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) => burnAxisTick(v)}
          width={burnAxisWidth(yMax)}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent labelFormatter={(v) => weekLabel(String(v))} />
          }
        />
        {mode === "cumulative" ? (
          <>
            <Area
              type="monotone"
              dataKey="gapBase"
              stackId="gap"
              stroke="none"
              fill="transparent"
              isAnimationActive={false}
              legendType="none"
              tooltipType="none"
            />
            <Area
              type="monotone"
              dataKey="gap"
              stackId="gap"
              stroke="none"
              fill="var(--color-gap)"
              fillOpacity={0.25}
              isAnimationActive={false}
            />
            <Area
              type="monotone"
              dataKey="completed"
              stroke="var(--color-completed)"
              fill="var(--color-completed)"
              fillOpacity={0.15}
              strokeWidth={2}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="planned"
              stroke="var(--color-planned)"
              strokeDasharray="4 4"
              dot={false}
              strokeWidth={1.5}
              isAnimationActive={false}
            />
            {forecastByWeek.size > 1 ? (
              <Line
                type="linear"
                dataKey="forecast"
                stroke="var(--color-forecast)"
                strokeDasharray="2 5"
                dot={false}
                strokeWidth={1.5}
                connectNulls={false}
                isAnimationActive={false}
              />
            ) : null}
          </>
        ) : (
          <>
            <Bar
              dataKey="planned"
              fill="var(--color-planned)"
              radius={2}
              isAnimationActive={false}
            />
            <Bar
              dataKey="completed"
              fill="var(--color-completed)"
              radius={2}
              isAnimationActive={false}
            />
          </>
        )}
        {todayWeek ? (
          <ReferenceLine
            x={todayWeek}
            stroke="var(--status-red)"
            strokeDasharray="4 4"
            label={{
              value: "Today",
              position: "top",
              fill: "var(--status-red)",
              fontSize: 10,
            }}
          />
        ) : null}
      </ComposedChart>
    </ChartContainer>
  );
}
