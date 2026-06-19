import type { ColumnKind, ColumnOption } from "@/lib/validations/boards";

export type RollupResult =
  | { kind: "blank" }
  | { kind: "number"; total: number }
  | {
      kind: "distribution";
      total: number;
      segments: { id: string; label: string; color: string; count: number }[];
    }
  | { kind: "dateSpan"; start: string; end: string }
  | { kind: "people"; count: number };

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
    case "text":
      return { kind: "blank" };
  }
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
