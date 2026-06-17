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
