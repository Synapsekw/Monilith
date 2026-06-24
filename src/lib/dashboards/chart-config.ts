import type { ChartConfig } from "@/lib/validations/dashboards";

/**
 * Upgrade a stored chart `config` to the v2 shape at read time.
 * Old widgets store `{ groupColumnId, chartStyle: "bar" | "pie" }`; v2 uses
 * `{ chartType, primary, measure, ... }`. No data migration — we map on read.
 */
export function normalizeChartConfig(
  raw: Record<string, unknown>,
): ChartConfig {
  if (
    raw &&
    typeof raw === "object" &&
    "chartType" in raw &&
    "primary" in raw
  ) {
    const cfg = raw as ChartConfig;
    return { ...cfg, measure: cfg.measure ?? { agg: "count" } };
  }
  const legacy = raw as { groupColumnId?: string; chartStyle?: "bar" | "pie" };
  return {
    chartType: legacy.chartStyle === "pie" ? "pie" : "bar",
    primary: { kind: "status", columnId: legacy.groupColumnId },
    measure: { agg: "count" },
  };
}

/** Chart types that read the optional `series` (second) dimension. */
export const MULTI_SERIES_TYPES: ChartConfig["chartType"][] = [
  "stackedBar",
  "groupedBar",
  "line",
  "area",
  "combo",
];

/** Chart types whose primary axis must be a date bucket. */
export const DATE_PRIMARY_TYPES: ChartConfig["chartType"][] = [
  "line",
  "area",
  "combo",
];
