import type { RollupResult } from "@/lib/boards/rollup";
import { CurrencyAmount } from "@/components/boards/CurrencyAmount";
import { formatDuration } from "@/lib/boards/time-format";
import { PercentBar } from "@/components/boards/cells";

// Pin the locale — `undefined` renders "Jan 1" on the Node server and "1 Jan"
// in a non-US-default browser → hydration mismatch. "en-US" matches the leaf
// DateCell this rollup mirrors and the rest of the board date formatters.
function fmt(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/** Read-only rollup summary shown on a collapsed parent's cells.
 *  `currencySettings` are the raw column settings, consulted only by the
 *  currency case (AED dirham-sign flag lives there; falls back to the
 *  result's code with the default-ON sign behavior). */
export function RollupCell({
  result,
  currencySettings,
}: {
  result: RollupResult;
  currencySettings?: unknown;
}) {
  switch (result.kind) {
    case "blank":
      return <span className="text-sm" />;
    case "number":
      return (
        <span className="text-muted-foreground text-sm tabular-nums">
          Σ {result.total}
        </span>
      );
    case "people":
      return (
        <span className="text-muted-foreground text-sm">
          {result.count} {result.count === 1 ? "person" : "people"}
        </span>
      );
    case "checkbox":
      return (
        <span className="text-muted-foreground text-sm tabular-nums">
          ✓ {result.checked}/{result.total}
        </span>
      );
    case "rating":
      return (
        <span className="text-muted-foreground text-sm tabular-nums">
          ★ {result.average}
        </span>
      );
    case "percent":
      return <PercentBar percent={result.average} />;
    case "currency":
      return (
        <span className="text-muted-foreground text-sm tabular-nums">
          Σ{" "}
          <CurrencyAmount
            amount={result.total}
            settings={currencySettings ?? { currency: result.currency }}
          />
        </span>
      );
    case "dateSpan":
      return (
        <span className="text-muted-foreground text-sm">
          {fmt(result.start)}
          {result.end !== result.start ? ` – ${fmt(result.end)}` : ""}
        </span>
      );
    case "distribution":
      return (
        <span
          role="img"
          aria-label={result.segments
            .map((s) => `${s.label}: ${s.count}`)
            .join(", ")}
          className="flex h-2 w-full max-w-[120px] items-center overflow-hidden rounded-full"
        >
          {result.segments.map((s) => (
            <span
              key={s.id}
              title={`${s.label}: ${s.count}`}
              className="h-full"
              style={{
                width: `${(s.count / result.total) * 100}%`,
                backgroundColor: s.color,
              }}
            />
          ))}
        </span>
      );
    case "duration":
      return (
        <span className="text-muted-foreground text-sm tabular-nums">
          Σ {formatDuration(result.totalSecs)}
          {result.estimateSecs
            ? ` / ${formatDuration(result.estimateSecs)}`
            : ""}
        </span>
      );
  }
}
