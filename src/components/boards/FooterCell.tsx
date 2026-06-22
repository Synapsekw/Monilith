"use client";

import { ChevronDown } from "lucide-react";
import {
  aggregate,
  type AggregateResult,
} from "@/lib/boards/aggregation";
import type {
  AggregationId,
  ColumnKind,
  ColumnOption,
} from "@/lib/validations/boards";
import { formatDuration } from "@/lib/boards/time-format";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** Short human labels for each aggregation, shown in the picker + as a prefix. */
export const AGGREGATION_LABEL: Record<AggregationId, string> = {
  count: "Count",
  count_filled: "Filled",
  count_empty: "Empty",
  count_unique: "Unique",
  sum: "Sum",
  avg: "Average",
  min: "Min",
  max: "Max",
  distribution: "Distribution",
  checked_total: "Checked",
  percent_checked: "% Checked",
  date_range: "Range",
  earliest: "Earliest",
  latest: "Latest",
  total_tracked: "Total",
  total_over_estimate: "Total / Est.",
};

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/** Pure presentational renderer for a computed footer aggregate. */
export function FooterValue({ result }: { result: AggregateResult }) {
  switch (result.kind) {
    case "empty":
      return null;
    case "number":
      return (
        <span className="text-foreground text-sm font-medium tabular-nums">
          {result.value}
          {result.style === "percent" ? "%" : ""}
        </span>
      );
    case "checkbox":
      return (
        <span className="text-foreground text-sm font-medium tabular-nums">
          {result.checked}/{result.total}
        </span>
      );
    case "date":
      return (
        <span className="text-foreground text-sm font-medium">
          {fmtDate(result.date)}
        </span>
      );
    case "dateSpan":
      return (
        <span className="text-foreground text-sm font-medium">
          {fmtDate(result.start)}
          {result.end !== result.start ? ` – ${fmtDate(result.end)}` : ""}
        </span>
      );
    case "duration":
      return (
        <span className="text-foreground text-sm font-medium tabular-nums">
          {formatDuration(result.totalSecs)}
          {result.estimateSecs
            ? ` / ${formatDuration(result.estimateSecs)}`
            : ""}
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
  }
}

export type FooterCellProps = {
  /** The kind to aggregate AS — the column's kind, or a mirror's target kind. */
  aggregateKind: ColumnKind;
  /** Per-item values already in `aggregateKind`'s shape (null = empty cell). */
  values: readonly unknown[];
  /** Options for distribution rendering (status/dropdown). */
  options?: readonly ColumnOption[];
  /** The currently chosen aggregation, if any. */
  current?: AggregationId;
  /** Allowed aggregations for the picker (default-first). */
  allowed: AggregationId[];
  /** Whether the viewer may change the aggregation. */
  canEdit: boolean;
  /** Persist a new choice (`null` clears it). */
  onChange: (agg: AggregationId | null) => void;
};

/**
 * One column's summary-footer cell: shows the chosen aggregate (or, when editable
 * and unset, a muted "Summary" affordance) and — for editors — a dropdown to pick
 * an aggregation or clear it. Computing the value is pure + client-side (0
 * round-trips); only the choice persists (a column-settings server action).
 */
export function FooterCell({
  aggregateKind,
  values,
  options,
  current,
  allowed,
  canEdit,
  onChange,
}: FooterCellProps) {
  const result: AggregateResult = current
    ? aggregate(aggregateKind, current, values, options)
    : { kind: "empty" };

  const label = current ? AGGREGATION_LABEL[current] : null;

  const body = (
    <span className="flex min-w-0 items-center gap-1.5 truncate">
      {label && result.kind !== "empty" && (
        <span className="text-muted-foreground shrink-0 text-[11px] uppercase tracking-wide">
          {label}
        </span>
      )}
      <FooterValue result={result} />
      {!current && canEdit && (
        <span className="text-muted-foreground/60 text-xs">Summary</span>
      )}
    </span>
  );

  if (!canEdit) {
    return <span className="flex min-w-0 items-center px-3">{body}</span>;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="hover:bg-accent/60 flex min-w-0 items-center justify-between gap-1 px-3 text-left transition-colors focus-visible:outline-none">
        {body}
        <ChevronDown className="text-muted-foreground/60 size-3 shrink-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 overflow-auto">
        {allowed.map((agg) => (
          <DropdownMenuItem
            key={agg}
            onSelect={() => onChange(agg)}
            className={current === agg ? "font-medium" : ""}
          >
            {AGGREGATION_LABEL[agg]}
          </DropdownMenuItem>
        ))}
        {current && (
          <DropdownMenuItem
            onSelect={() => onChange(null)}
            className="text-muted-foreground"
          >
            None
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
