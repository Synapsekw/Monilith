"use client";

import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  AXIS_PROPS,
  GRID_STROKE,
} from "@/components/dashboards/widgets/chart-theme";
import type { UsageSummary } from "@/lib/ai/usage-summary";

const CHART_CONFIG: ChartConfig = {
  credits: { label: "Credits", color: "var(--primary)" },
};

const monthLabel = (m: string) =>
  new Date(m).toLocaleDateString(undefined, { month: "short" });
const monthLabelLong = (m: string) =>
  new Date(m).toLocaleDateString(undefined, { month: "long", year: "numeric" });

/**
 * The recharts-backed 6-month credits trend. Never import this statically from
 * first-paint code — go through `LazyUsageTrendChart`, which keeps recharts out
 * of the `/settings/ai` first-load JS.
 */
export function UsageTrendChart({
  months,
}: {
  months: UsageSummary["months"];
}) {
  return (
    <ChartContainer config={CHART_CONFIG} className="h-40 w-full">
      <LineChart data={months}>
        <CartesianGrid
          stroke={GRID_STROKE}
          strokeDasharray="3 3"
          vertical={false}
        />
        <XAxis dataKey="month" {...AXIS_PROPS} tickFormatter={monthLabel} />
        <YAxis {...AXIS_PROPS} width={32} />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(value) => monthLabelLong(String(value))}
            />
          }
        />
        <Line
          type="monotone"
          dataKey="credits"
          stroke="var(--color-credits)"
          strokeWidth={2.5}
          dot={false}
          activeDot={{ r: 4 }}
        />
      </LineChart>
    </ChartContainer>
  );
}
