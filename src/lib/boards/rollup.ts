import type { ColumnKind, ColumnOption } from "@/lib/validations/boards";
import { trackedSeconds, type TimeEntryLike } from "@/lib/boards/time-format";

export type RollupResult =
  | { kind: "blank" }
  | { kind: "number"; total: number }
  | {
      kind: "distribution";
      total: number;
      segments: { id: string; label: string; color: string; count: number }[];
    }
  | { kind: "dateSpan"; start: string; end: string }
  | { kind: "people"; count: number }
  | { kind: "checkbox"; checked: number; total: number }
  | { kind: "rating"; average: number }
  | { kind: "duration"; totalSecs: number; estimateSecs?: number };

type Options = readonly ColumnOption[] | undefined;

/**
 * Aggregate a parent's subitem cell values for one column into a renderable
 * rollup. `values` are raw JSON cell values across the subitems (nulls allowed
 * for empty cells). Pure — no DOM, no I/O.
 */
export function rollupCell(
  kind: ColumnKind,
  values: readonly unknown[],
  options?: Options,
): RollupResult {
  const present = values.filter((v) => v != null);
  if (present.length === 0) return { kind: "blank" };

  switch (kind) {
    case "numbers": {
      let total = 0;
      let any = false;
      for (const v of present) {
        const n = (v as { n?: unknown }).n;
        if (typeof n === "number" && Number.isFinite(n)) {
          total += n;
          any = true;
        }
      }
      return any ? { kind: "number", total } : { kind: "blank" };
    }
    case "status": {
      const counts = new Map<string, number>();
      for (const v of present) {
        const id = (v as { optionId?: string | null }).optionId;
        if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
      }
      return distribution(counts, options);
    }
    case "dropdown": {
      const counts = new Map<string, number>();
      for (const v of present) {
        for (const id of (v as { optionIds?: string[] }).optionIds ?? []) {
          counts.set(id, (counts.get(id) ?? 0) + 1);
        }
      }
      return distribution(counts, options);
    }
    case "date": {
      let min: string | null = null;
      let max: string | null = null;
      for (const v of present) {
        const d = (v as { date?: string }).date;
        const e = (v as { end?: string }).end ?? d;
        if (typeof d === "string" && (min === null || d < min)) min = d;
        if (typeof e === "string" && (max === null || e > max)) max = e;
      }
      return min && max
        ? { kind: "dateSpan", start: min, end: max }
        : { kind: "blank" };
    }
    case "people": {
      const ids = new Set<string>();
      for (const v of present) {
        for (const id of (v as { userIds?: string[] }).userIds ?? [])
          ids.add(id);
      }
      return ids.size > 0
        ? { kind: "people", count: ids.size }
        : { kind: "blank" };
    }
    case "checkbox": {
      let checked = 0;
      for (const v of present)
        if ((v as { checked?: boolean }).checked) checked++;
      return { kind: "checkbox", checked, total: present.length };
    }
    case "rating": {
      let sum = 0;
      let n = 0;
      for (const v of present) {
        const r = (v as { rating?: number }).rating;
        if (typeof r === "number") {
          sum += r;
          n++;
        }
      }
      return n
        ? { kind: "rating", average: Math.round((sum / n) * 10) / 10 }
        : { kind: "blank" };
    }
    case "text":
    case "link":
    case "email":
    case "phone":
    case "files":
    case "time_tracking":
    // relation has no cell_values; its collapsed rollup ("N linked") derives
    // from relation_links and is rendered in BoardTable via relationRollup().
    case "relation":
    // mirror has no cell_values either; it derives from relation_links + the
    // target board's cell_values and has no parent rollup of its own.
    case "mirror":
      return { kind: "blank" };
  }
}

/**
 * Parent rollup for a time-tracking column. Sums subitem tracked totals (from
 * time_entries) + estimates (from the subitems' estimate cell values). Pure.
 */
export function rollupTimeTracking(
  entries: readonly TimeEntryLike[],
  estimateSecsList: readonly number[],
  nowMs: number,
): RollupResult {
  const totalSecs = trackedSeconds(entries, nowMs);
  const estimateSecs = estimateSecsList.reduce((a, b) => a + b, 0);
  if (totalSecs === 0 && estimateSecs === 0) return { kind: "blank" };
  return estimateSecs > 0
    ? { kind: "duration", totalSecs, estimateSecs }
    : { kind: "duration", totalSecs };
}

function distribution(
  counts: Map<string, number>,
  options: Options,
): RollupResult {
  if (counts.size === 0) return { kind: "blank" };
  let total = 0;
  const segments: {
    id: string;
    label: string;
    color: string;
    count: number;
  }[] = [];
  for (const [id, count] of counts) {
    total += count;
    const opt = options?.find((o) => o.id === id);
    segments.push({
      id,
      count,
      label: opt?.label ?? "—",
      color: opt?.color ?? "#9ca3af",
    });
  }
  segments.sort((a, b) => b.count - a.count); // most frequent first
  return { kind: "distribution", total, segments };
}
