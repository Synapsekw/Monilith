type BurnMode = "cumulative" | "weekly";

/**
 * The burn chart's visible key. The forecast shares Completed's colour, so the
 * line STYLE is what tells them apart: each entry draws a short sample of its
 * stroke (dashed, solid, dotted) next to its name. Plain SVG, recharts-free,
 * so it renders with the page while the chart itself loads lazily.
 */
const ENTRIES = [
  {
    key: "planned",
    label: "Planned",
    style: "dashed",
    color: "var(--muted-foreground)",
    dash: "4 3",
  },
  {
    key: "completed",
    label: "Completed",
    style: "solid",
    color: "var(--primary)",
    dash: undefined,
  },
  {
    key: "forecast",
    label: "Forecast",
    style: "dotted",
    color: "var(--primary)",
    dash: "1.5 3",
  },
] as const;

export function BurnLegend({
  mode,
  forecast = false,
}: {
  mode: BurnMode;
  /** Whether the chart draws a forecast line. */
  forecast?: boolean;
}) {
  const entries = ENTRIES.filter(
    (e) => e.key !== "forecast" || (forecast && mode === "cumulative"),
  );
  return (
    <ul
      aria-label="Legend"
      data-testid="burn-legend"
      className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs"
    >
      {entries.map((e) => (
        <li
          key={e.key}
          data-style={mode === "weekly" ? "bar" : e.style}
          className="inline-flex items-center gap-1.5"
        >
          {mode === "weekly" ? (
            <span
              aria-hidden
              className="size-2 rounded-[2px]"
              style={{ backgroundColor: e.color }}
            />
          ) : (
            <svg aria-hidden width="18" height="6" className="shrink-0">
              <line
                x1="0"
                y1="3"
                x2="18"
                y2="3"
                stroke={e.color}
                strokeWidth="2"
                strokeDasharray={e.dash}
                strokeLinecap={e.style === "dotted" ? "round" : undefined}
              />
            </svg>
          )}
          {e.label}
          {mode === "cumulative" ? (
            <span className="sr-only"> ({e.style} line)</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
