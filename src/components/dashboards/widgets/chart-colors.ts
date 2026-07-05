import type { PivotRow } from "@/lib/dashboards/series";
import {
  CATEGORICAL_PALETTE,
  SPECTRUM_SOLID,
} from "@/components/dashboards/widgets/chart-theme";

export type Paint = { kind: "solid"; color: string } | { kind: "hero" };

export type ChartColors = {
  series: { key: string; paint: Paint }[];
  cells: { label: string; paint: Paint }[] | null;
};

const CIRCULAR = new Set(["pie", "donut", "radial"]);

function cat(i: number): Paint {
  return {
    kind: "solid",
    color: CATEGORICAL_PALETTE[i % CATEGORICAL_PALETTE.length],
  };
}

export function resolveChartColors(args: {
  chartType: string;
  rows: PivotRow[];
  series: { key: string; color: string | null }[];
}): ChartColors {
  const { chartType, rows, series } = args;
  const multi = series.length > 1;

  const resolvedSeries = series.map((s, i) => ({
    key: s.key,
    paint: (s.color != null
      ? { kind: "solid", color: s.color }
      : multi
        ? cat(i)
        : { kind: "hero" }) as Paint,
  }));

  const cellColor = (label: string, row: PivotRow): string | undefined => {
    const v = row[`__color_${label}`];
    return typeof v === "string" ? v : undefined;
  };

  // Circular charts always color per slice (differentiation is meaningful).
  if (CIRCULAR.has(chartType)) {
    const cells = rows.map((r, i) => {
      const label = String(r.__label);
      const c = cellColor(label, r);
      return {
        label,
        paint: (c ? { kind: "solid", color: c } : cat(i)) as Paint,
      };
    });
    return { series: resolvedSeries, cells };
  }

  // Single-series bar: per-cell solids IF any configured color exists, else hero.
  if (!multi) {
    const anyCell = rows.some((r) => cellColor(String(r.__label), r) != null);
    if (anyCell) {
      const cells = rows.map((r) => {
        const label = String(r.__label);
        const c = cellColor(label, r);
        return {
          label,
          paint: (c ? { kind: "solid", color: c } : { kind: "hero" }) as Paint,
        };
      });
      return { series: resolvedSeries, cells };
    }
  }

  // Multi-series, or single-series with no per-cell colors → color by series.
  return { series: resolvedSeries, cells: null };
}

export function solidOf(paint: Paint): string {
  return paint.kind === "hero" ? SPECTRUM_SOLID : paint.color;
}

const slug = (s: string) =>
  s.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "");

export function gradientId(
  widgetId: string,
  role: "bar" | "area" | "stroke",
  token: string,
): string {
  return `g-${slug(widgetId)}-${role}-${slug(token)}`;
}

export function paintFill(
  widgetId: string,
  paint: Paint,
  role: "bar" | "area",
): string {
  const token = paint.kind === "hero" ? "hero" : paint.color;
  return `url(#${gradientId(widgetId, role, token)})`;
}

export function paintStroke(widgetId: string, paint: Paint): string {
  if (paint.kind === "hero")
    return `url(#${gradientId(widgetId, "stroke", "hero")})`;
  return paint.color;
}

export type GradientSpec = { id: string } & (
  | { kind: "bar" | "area"; color: string }
  | { kind: "hero-bar" | "hero-area" | "hero-stroke" }
);

/** Every gradient the chart's paints reference — deduped by id, for <ChartDefs>. */
export function collectGradients(
  widgetId: string,
  colors: ChartColors,
): GradientSpec[] {
  const byId = new Map<string, GradientSpec>();
  const add = (spec: GradientSpec) => {
    if (!byId.has(spec.id)) byId.set(spec.id, spec);
  };
  const paints: Paint[] = [
    ...colors.series.map((s) => s.paint),
    ...(colors.cells ?? []).map((c) => c.paint),
  ];
  for (const p of paints) {
    if (p.kind === "hero") {
      add({ id: gradientId(widgetId, "bar", "hero"), kind: "hero-bar" });
      add({ id: gradientId(widgetId, "area", "hero"), kind: "hero-area" });
      add({ id: gradientId(widgetId, "stroke", "hero"), kind: "hero-stroke" });
    } else {
      add({
        id: gradientId(widgetId, "bar", p.color),
        kind: "bar",
        color: p.color,
      });
      add({
        id: gradientId(widgetId, "area", p.color),
        kind: "area",
        color: p.color,
      });
    }
  }
  return [...byId.values()];
}
