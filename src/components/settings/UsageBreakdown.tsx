"use client";

import { useState } from "react";
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
import { cn } from "@/lib/utils";
import type { UsageSummary } from "@/lib/ai/usage-summary";

type Range = "month" | "6months";

const CHART_CONFIG: ChartConfig = {
  credits: { label: "Credits", color: "var(--primary)" },
};

const monthLabel = (m: string) =>
  new Date(m).toLocaleDateString(undefined, { month: "short" });
const monthLabelLong = (m: string) =>
  new Date(m).toLocaleDateString(undefined, { month: "long", year: "numeric" });

/**
 * Per-feature spend breakdown + 6-month credits trend, fed the
 * server-preloaded `UsageSummary` (see `getUsageSummary`). The range toggle is
 * pure client state over data already loaded for both ranges — 0 new server
 * round-trips per AGENTS.md working agreement #5.
 */
export function UsageBreakdown({ summary }: { summary: UsageSummary }) {
  const [range, setRange] = useState<Range>("6months");
  const { entitlement, months, features } = summary;
  // `ai_usage_summary` orders by month ascending, so the last row is the
  // current month — the same window `features` (this-month-only) covers.
  const thisMonth = months.at(-1) ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-medium">
          {entitlement.creditsLimit === null
            ? "Unmetered this month"
            : `${entitlement.creditsUsed} / ${entitlement.creditsLimit} credits this month`}
        </p>
        <div className="flex gap-1" role="group" aria-label="Usage range">
          <button
            type="button"
            aria-pressed={range === "month"}
            className={cn(
              "rounded-sm px-2 py-1 text-xs font-medium transition-colors",
              range === "month"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-state-hover",
            )}
            onClick={() => setRange("month")}
          >
            This month
          </button>
          <button
            type="button"
            aria-pressed={range === "6months"}
            className={cn(
              "rounded-sm px-2 py-1 text-xs font-medium transition-colors",
              range === "6months"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-state-hover",
            )}
            onClick={() => setRange("6months")}
          >
            6 months
          </button>
        </div>
      </div>

      {/* Per-feature breakdown for the current month — always visible; the
          range toggle above governs the trend view below, not this list. */}
      <div>
        {features.length === 0 ? (
          <p className="text-muted-foreground text-xs">
            No AI activity yet this month.
          </p>
        ) : (
          features.map((f) => (
            <div
              key={f.feature}
              className="border-border flex items-center justify-between border-b py-2 text-xs last:border-b-0"
            >
              <span className="text-foreground font-medium">{f.feature}</span>
              <span className="text-muted-foreground">
                {f.credits.toFixed(0)} credits · {f.calls} calls
              </span>
            </div>
          ))
        )}
      </div>

      {range === "month" ? (
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-2xl font-semibold tabular-nums">
            {thisMonth ? thisMonth.credits.toFixed(0) : 0}
          </span>
          <span className="text-muted-foreground text-xs">
            credits this month
            {thisMonth ? ` · ${thisMonth.calls} calls` : ""}
          </span>
        </div>
      ) : (
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
      )}
    </div>
  );
}
