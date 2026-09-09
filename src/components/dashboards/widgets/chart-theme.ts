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

/** Spectrum hero gradient for a single uncolored metric. Theme-aware tokens,
 * derived from `--brand` (see `--chart-spectrum-1..3` in globals.css) so
 * every theme preset gets a coherent ramp for free. */
export const SPECTRUM_STOPS = [
  "var(--chart-spectrum-1)",
  "var(--chart-spectrum-2)",
  "var(--chart-spectrum-3)",
] as const;
export const SPECTRUM_SOLID = "var(--chart-spectrum-2)";

/** Signature motion. */
export const CHART_MOTION = { durationMs: 700, staggerMs: 90 } as const;
