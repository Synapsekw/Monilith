/** A single aggregate bucket as returned by the dashboard_aggregate RPC. */
export type AggregateBucket = { group_key: string | null; metric: number };

/** Stable, order-independent hash of a widget config — used as a query-key part. */
export function configHash(config: Record<string, unknown>): string {
  const sortedKeys = Object.keys(config).sort();
  const stable: Record<string, unknown> = {};
  for (const k of sortedKeys) stable[k] = config[k];
  return JSON.stringify(stable);
}

/** Collapse aggregate buckets into a single scalar (Number widget). */
export function numberFromBuckets(buckets: AggregateBucket[]): number {
  return buckets.reduce((sum, b) => sum + (b.metric ?? 0), 0);
}

/** Display formatting for a metric. avg → 1 decimal; others → integer-ish. */
export function formatMetric(
  value: number,
  agg: "count" | "sum" | "avg",
): string {
  if (agg === "avg") return value.toFixed(1);
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

/** A status/dropdown column option as resolved from columns.settings. */
export type ColumnOption = { id: string; label: string; color: string };

/** Metadata about a widget's group column, resolved server-side for rendering. */
export type ColumnMeta = { kind: string; options: ColumnOption[] };

/** A display-ready bucket: option label/color joined to its count. */
export type ShapedBucket = {
  key: string | null;
  label: string;
  color: string;
  count: number;
};

const NONE_COLOR = "var(--muted-foreground)";

/**
 * Join aggregate buckets to a status column's options for rendering.
 * - one row per option (in option order), even when count is 0;
 * - a trailing "None" row for the null group key (items with no value);
 * - unknown ids (e.g. a deleted option still present in old cells) → "Unknown".
 */
export function shapeBuckets(
  buckets: AggregateBucket[],
  meta: ColumnMeta,
): ShapedBucket[] {
  const counts = new Map<string | null, number>();
  for (const b of buckets) counts.set(b.group_key, b.metric ?? 0);

  const rows: ShapedBucket[] = meta.options.map((o) => ({
    key: o.id,
    label: o.label,
    color: o.color,
    count: counts.get(o.id) ?? 0,
  }));

  const known = new Set(meta.options.map((o) => o.id));
  let unknown = 0;
  let none = 0;
  for (const [key, count] of counts) {
    if (key === null) none += count;
    else if (!known.has(key)) unknown += count;
  }
  if (unknown > 0)
    rows.push({
      key: "__unknown__",
      label: "Unknown",
      color: NONE_COLOR,
      count: unknown,
    });
  if (none > 0)
    rows.push({ key: null, label: "None", color: NONE_COLOR, count: none });

  return rows;
}

/** Total across buckets (denominator for battery percentages). */
export function bucketsTotal(buckets: AggregateBucket[]): number {
  return buckets.reduce((sum, b) => sum + (b.metric ?? 0), 0);
}
