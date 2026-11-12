import { cn } from "@/lib/utils";

export type ChartLegendEntry = {
  /** Series key or slice label — unique within one chart. */
  key: string;
  label: string;
  /** The mark's solid colour (a token or a configured value) — never a
   *  `url(#gradient)` reference, which is not a valid background. */
  color: string;
  value: number;
};

const compact = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1,
});

/** Full digits while they stay short; compact ("1.2M") beyond that. */
export function formatChartValue(value: number): string {
  return Math.abs(value) >= 100_000
    ? compact.format(value)
    : value.toLocaleString();
}

/**
 * Chart legend: one row per series/slice — colour key, name, value.
 *
 * Rendered as HTML beside the chart instead of through recharts' `<Legend>`,
 * whose payload reports a bar's `fill` verbatim. Our marks are filled with
 * `url(#gradient)`, so the stock legend painted `background-color: url(…)` —
 * i.e. no key at all — and it never carried a value.
 *
 * Sizing is driven by the enclosing size container (see `ChartFrame`):
 *  - `placement="auto"`: stacked under the chart, or a column beside it once
 *    the widget is wide enough (`@md`);
 *  - `placement="bottom"`: always under the chart (cartesian charts need
 *    their width);
 *  - hidden outright when the widget is too short to spare the room, so the
 *    mark itself always wins the space.
 */
export function ChartLegend({
  entries,
  placement = "bottom",
  className,
}: {
  entries: ChartLegendEntry[];
  placement?: "auto" | "bottom";
  className?: string;
}) {
  if (entries.length === 0) return null;
  const side = placement === "auto";
  return (
    <ul
      data-slot="chart-legend"
      aria-label="Legend"
      className={cn(
        "hidden max-h-[40%] shrink-0 flex-wrap content-start justify-center gap-x-3 gap-y-1 overflow-y-auto text-xs [@container_(min-height:6rem)]:flex",
        side &&
          "@md:max-h-full @md:w-2/5 @md:max-w-56 @md:flex-col @md:flex-nowrap @md:justify-center @md:gap-y-1.5 @md:self-center",
        className,
      )}
    >
      {entries.map((e) => (
        <li
          key={e.key}
          data-slot="chart-legend-item"
          className={cn(
            "flex max-w-full min-w-0 items-center gap-1.5",
            side && "@md:w-full",
          )}
        >
          <span
            data-testid="chart-legend-key"
            data-color={e.color}
            aria-hidden
            className="size-2 shrink-0 rounded-[2px]"
            style={{ backgroundColor: e.color }}
          />
          <span
            data-testid="chart-legend-name"
            className="text-muted-foreground min-w-0 truncate"
            title={e.label}
          >
            {e.label}
          </span>
          <span
            data-testid="chart-legend-value"
            className={cn(
              "text-foreground shrink-0 font-mono font-medium tabular-nums",
              side && "@md:ml-auto @md:pl-2",
            )}
          >
            {formatChartValue(e.value)}
          </span>
        </li>
      ))}
    </ul>
  );
}
