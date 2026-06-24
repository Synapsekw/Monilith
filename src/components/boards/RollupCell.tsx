import type { RollupResult } from "@/lib/boards/rollup";
import { formatDuration } from "@/lib/boards/time-format";
import { PercentBar } from "@/components/boards/cells";

function fmt(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/** Read-only rollup summary shown on a collapsed parent's cells. */
export function RollupCell({ result }: { result: RollupResult }) {
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
      return <PercentBar percent={result.average} muted />;
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
