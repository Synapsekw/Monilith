import type {
  AggregationId,
  ColumnKind,
  ColumnOption,
} from "@/lib/validations/boards";
import { rollupCell } from "@/lib/boards/rollup";

/**
 * The count family is presence-based and applies to every column kind. Order is
 * the UI order; `count` is the generic default for kinds with no richer summary.
 */
export const COUNT_FAMILY: readonly AggregationId[] = [
  "count",
  "count_filled",
  "count_empty",
  "count_unique",
];

/**
 * The aggregations a column of `kind` may show in the summary footer, in UI
 * order — the first entry is the sensible default. Pure; safe on client + server.
 *
 * A `mirror` column delegates to the kind of the column it mirrors (`targetKind`):
 * mirrored values are aggregated exactly as the target kind would be. When the
 * target is unknown (settings incomplete) or itself a mirror (no recursion), it
 * falls back to the universal count family.
 */
export function allowedAggregations(
  kind: ColumnKind,
  targetKind?: ColumnKind,
): AggregationId[] {
  switch (kind) {
    case "numbers":
      return ["sum", "avg", "min", "max", ...COUNT_FAMILY];
    case "rating":
      return ["avg", "min", "max", ...COUNT_FAMILY];
    case "status":
    case "dropdown":
      return ["distribution", ...COUNT_FAMILY];
    case "checkbox":
      return ["checked_total", "percent_checked", ...COUNT_FAMILY];
    case "date":
      return ["date_range", "earliest", "latest", ...COUNT_FAMILY];
    case "people":
      return ["count_unique", "count_filled", "count", "count_empty"];
    case "time_tracking":
      return ["total_tracked", "total_over_estimate", ...COUNT_FAMILY];
    case "files":
    case "relation":
      return ["count_filled", "count", "count_empty", "count_unique"];
    case "text":
    case "link":
    case "email":
    case "phone":
      return [...COUNT_FAMILY];
    case "mirror":
      if (!targetKind || targetKind === "mirror") return [...COUNT_FAMILY];
      return allowedAggregations(targetKind);
  }
}

/** A computed footer summary, ready to render. `empty` = nothing to show. */
export type AggregateResult =
  | { kind: "empty" }
  | { kind: "number"; value: number; style?: "plain" | "percent" }
  | {
      kind: "distribution";
      total: number;
      segments: { id: string; label: string; color: string; count: number }[];
    }
  | { kind: "dateSpan"; start: string; end: string }
  | { kind: "date"; date: string }
  | { kind: "checkbox"; checked: number; total: number }
  | { kind: "duration"; totalSecs: number; estimateSecs?: number };

const EMPTY: AggregateResult = { kind: "empty" };
const num = (value: number, style?: "percent"): AggregateResult => ({
  kind: "number",
  value,
  ...(style ? { style } : {}),
});

/**
 * Compute one column-summary footer value. `values` are the per-item raw cell
 * values for the column (null for empty cells); `kind` selects how they are read.
 *
 * For a mirror column the caller resolves the target column's kind and passes
 * the flattened mirrored values — aggregation then behaves exactly as the target
 * kind would. time_tracking values are pre-reduced `{ trackedSecs, estimateSecs }`
 * objects (the caller turns time_entries into trackedSecs). Pure — no DOM/I/O.
 */
export function aggregate(
  kind: ColumnKind,
  aggId: AggregationId,
  values: readonly unknown[],
  options?: readonly ColumnOption[],
): AggregateResult {
  // count family — presence-based, applies to every kind
  switch (aggId) {
    case "count":
      return num(values.length);
    case "count_filled":
      return num(values.filter((v) => isFilled(kind, v)).length);
    case "count_empty":
      return num(values.filter((v) => !isFilled(kind, v)).length);
    case "count_unique":
      return num(uniqueCount(kind, values));
  }

  const present = values.filter((v) => isFilled(kind, v));

  switch (aggId) {
    case "sum":
    case "avg":
    case "min":
    case "max": {
      const nums = numericValues(kind, present);
      if (nums.length === 0) return EMPTY;
      if (aggId === "sum") return num(nums.reduce((a, b) => a + b, 0));
      if (aggId === "min") return num(Math.min(...nums));
      if (aggId === "max") return num(Math.max(...nums));
      const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
      return num(Math.round(avg * 100) / 100);
    }
    case "distribution": {
      const r = rollupCell(kind, values, options);
      return r.kind === "distribution"
        ? { kind: "distribution", total: r.total, segments: r.segments }
        : EMPTY;
    }
    case "checked_total": {
      const all = values.filter((v) => v != null);
      if (all.length === 0) return EMPTY;
      const checked = all.filter(
        (v) => (v as { checked?: boolean }).checked,
      ).length;
      return { kind: "checkbox", checked, total: all.length };
    }
    case "percent_checked": {
      const all = values.filter((v) => v != null);
      if (all.length === 0) return EMPTY;
      const checked = all.filter(
        (v) => (v as { checked?: boolean }).checked,
      ).length;
      return num(Math.round((checked / all.length) * 100), "percent");
    }
    case "date_range": {
      const r = rollupCell("date", values, options);
      return r.kind === "dateSpan"
        ? { kind: "dateSpan", start: r.start, end: r.end }
        : EMPTY;
    }
    case "earliest":
    case "latest": {
      const starts = present
        .map((v) => (v as { date?: string }).date)
        .filter((d): d is string => typeof d === "string");
      if (starts.length === 0) return EMPTY;
      if (aggId === "earliest")
        return { kind: "date", date: starts.reduce((a, b) => (a < b ? a : b)) };
      const ends = present
        .map((v) => (v as { end?: string; date?: string }).end ?? (v as { date?: string }).date)
        .filter((d): d is string => typeof d === "string");
      return { kind: "date", date: ends.reduce((a, b) => (a > b ? a : b)) };
    }
    case "total_tracked":
    case "total_over_estimate": {
      let totalSecs = 0;
      let estimateSecs = 0;
      for (const v of values) {
        const t = (v as { trackedSecs?: number } | null)?.trackedSecs;
        const e = (v as { estimateSecs?: number } | null)?.estimateSecs;
        if (typeof t === "number") totalSecs += t;
        if (typeof e === "number") estimateSecs += e;
      }
      if (totalSecs === 0 && estimateSecs === 0) return EMPTY;
      return aggId === "total_over_estimate" && estimateSecs > 0
        ? { kind: "duration", totalSecs, estimateSecs }
        : { kind: "duration", totalSecs };
    }
  }

  return EMPTY;
}

/** Whether a raw cell value carries meaningful content for its kind. */
function isFilled(kind: ColumnKind, v: unknown): boolean {
  if (v == null) return false;
  const o = v as Record<string, unknown>;
  switch (kind) {
    case "text":
      return typeof o.text === "string" && o.text.trim().length > 0;
    case "link":
      return typeof o.url === "string" && o.url.length > 0;
    case "email":
      return typeof o.email === "string" && o.email.length > 0;
    case "phone":
      return typeof o.phone === "string" && o.phone.length > 0;
    case "status":
      return o.optionId != null;
    case "dropdown":
      return Array.isArray(o.optionIds) && o.optionIds.length > 0;
    case "people":
      return Array.isArray(o.userIds) && o.userIds.length > 0;
    case "date":
      return typeof o.date === "string" && o.date.length > 0;
    case "numbers":
      return typeof o.n === "number" && Number.isFinite(o.n);
    case "checkbox":
      return o.checked === true;
    case "rating":
      return typeof o.rating === "number" && o.rating >= 1;
    case "time_tracking":
      return (
        (typeof o.trackedSecs === "number" && o.trackedSecs > 0) ||
        (typeof o.estimateSecs === "number" && o.estimateSecs > 0)
      );
    // derived kinds: the caller passes presence (non-null = filled)
    case "files":
    case "relation":
    case "mirror":
      return true;
  }
}

/** Extract the numeric scalars for sum/avg/min/max from filled values. */
function numericValues(kind: ColumnKind, present: readonly unknown[]): number[] {
  const key = kind === "rating" ? "rating" : "n";
  const out: number[] = [];
  for (const v of present) {
    const n = (v as Record<string, unknown>)[key];
    if (typeof n === "number" && Number.isFinite(n)) out.push(n);
  }
  return out;
}

/** Count distinct identities across filled values (people/dropdown flatten). */
function uniqueCount(kind: ColumnKind, values: readonly unknown[]): number {
  const set = new Set<string>();
  for (const v of values) {
    if (!isFilled(kind, v)) continue;
    for (const id of identitiesOf(kind, v)) set.add(id);
  }
  return set.size;
}

function identitiesOf(kind: ColumnKind, v: unknown): string[] {
  const o = v as Record<string, unknown>;
  switch (kind) {
    case "people":
      return (o.userIds as string[] | undefined) ?? [];
    case "dropdown":
      return (o.optionIds as string[] | undefined) ?? [];
    case "status":
      return o.optionId != null ? [String(o.optionId)] : [];
    case "text":
      return [String(o.text)];
    case "link":
      return [String(o.url)];
    case "email":
      return [String(o.email)];
    case "phone":
      return [String(o.phone)];
    case "numbers":
      return [String(o.n)];
    case "rating":
      return [String(o.rating)];
    case "date":
      return [String(o.date)];
    case "checkbox":
      return [String(o.checked)];
    default:
      return [JSON.stringify(v)];
  }
}
