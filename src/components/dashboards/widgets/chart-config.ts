import type { ChartConfig } from "@/components/ui/chart";

/**
 * Map pivoted series ({ key, color }) into shadcn's ChartConfig so
 * ChartTooltipContent / ChartLegendContent resolve per-series --color-<key>.
 * Labels default to the series key (matches the current Legend/Tooltip text).
 */
export function buildChartConfig(
  series: { key: string; color: string }[],
): ChartConfig {
  return Object.fromEntries(
    series.map((s) => [s.key, { label: s.key, color: s.color }]),
  );
}
