import type { ChartType } from "@/lib/validations/dashboards";

export type SeriesPoint = {
  primaryKey: string | null;
  primaryLabel: string;
  seriesKey: string | null;
  seriesLabel: string | null;
  seriesColor: string | null;
  value: number;
};

export type SeriesData = {
  chartType: ChartType;
  primaryKind: "status" | "dropdown" | "people" | "date";
  seriesKind: "status" | "dropdown" | "people" | "date" | null;
  points: SeriesPoint[];
};

/** A recharts-ready row: a primary label plus one numeric field per series. */
export type PivotRow = Record<string, string | number>;

export type PivotedSeries = {
  rows: PivotRow[];
  series: { key: string; color: string | null }[];
};

/**
 * Pivot flat (primary × series) points into recharts rows.
 * - With a series split: each distinct series label becomes a numeric field.
 * - Without a split: a single "Value" field; per-row color is stashed as
 *   `__color_<label>` so the chart can color bars/slices individually.
 */
export function pivotSeries(data: SeriesData): PivotedSeries {
  const rowByPrimary = new Map<string, PivotRow>();
  const order: string[] = [];
  const seriesColor = new Map<string, string | null>();
  const seriesOrder: string[] = [];

  for (const p of data.points) {
    if (!rowByPrimary.has(p.primaryLabel)) {
      rowByPrimary.set(p.primaryLabel, { __label: p.primaryLabel });
      order.push(p.primaryLabel);
    }
    const row = rowByPrimary.get(p.primaryLabel)!;

    if (data.seriesKind && p.seriesLabel) {
      row[p.seriesLabel] = (Number(row[p.seriesLabel]) || 0) + p.value;
      if (!seriesColor.has(p.seriesLabel)) {
        seriesColor.set(p.seriesLabel, p.seriesColor);
        seriesOrder.push(p.seriesLabel);
      }
    } else {
      row.Value = (Number(row.Value) || 0) + p.value;
      if (p.seriesColor != null)
        row[`__color_${p.primaryLabel}`] = p.seriesColor;
    }
  }

  const series = data.seriesKind
    ? seriesOrder.map((key) => ({ key, color: seriesColor.get(key) ?? null }))
    : [{ key: "Value", color: null }];

  return { rows: order.map((k) => rowByPrimary.get(k)!), series };
}
