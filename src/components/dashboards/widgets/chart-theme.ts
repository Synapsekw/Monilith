/**
 * Shared recharts axis/grid theming so every chart reads from Pulse tokens.
 * Tooltip/legend styling now comes from shadcn's ChartTooltipContent /
 * ChartLegendContent (see src/components/ui/chart.tsx).
 */
export const AXIS_PROPS = {
  tick: { fontSize: 11, fill: "var(--muted-foreground)" },
  stroke: "var(--border)",
} as const;

export const GRID_STROKE = "var(--border)";

/** Distinct-but-cohesive hues for genuinely uncolored multi-series (meaningful
 * differentiation — color encodes which series). Theme-aware tokens. */
export const CATEGORICAL_PALETTE = [
  "var(--chart-cat-1)",
  "var(--chart-cat-2)",
  "var(--chart-cat-3)",
  "var(--chart-cat-4)",
  "var(--chart-cat-5)",
  "var(--chart-cat-6)",
] as const;

/** Spectrum hero gradient for a single uncolored metric. */
export const SPECTRUM_STOPS = ["#4f46e5", "#7c3aed", "#db2777"] as const;
export const SPECTRUM_SOLID = "#7c3aed";

/** Signature motion. */
export const CHART_MOTION = { durationMs: 700, staggerMs: 90 } as const;
