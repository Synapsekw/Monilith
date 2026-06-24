/** Shared recharts theming so every chart reads from Pulse tokens. */
export const AXIS_PROPS = {
  tick: { fontSize: 11, fill: "var(--muted-foreground)" },
  stroke: "var(--border)",
} as const;

export const TOOLTIP_STYLE = {
  contentStyle: {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    fontSize: 12,
    color: "var(--foreground)",
  },
  cursor: { fill: "var(--muted)" },
} as const;

export const GRID_STROKE = "var(--border)";
