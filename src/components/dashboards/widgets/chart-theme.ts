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
