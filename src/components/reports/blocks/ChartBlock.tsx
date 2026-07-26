// src/components/reports/blocks/ChartBlock.tsx
import type { ChartBlockOptions } from "@/lib/reports/config";
import type { ChartSeries } from "@/lib/reports/chart-data";
import { DonutChart } from "./DonutChart";
import { BarsChart } from "./BarsChart";
import { ChartLegend } from "./ChartLegend";

function heading(options: ChartBlockOptions, series: ChartSeries): string {
  if (options.title.trim() !== "") return options.title.trim();
  return series.categoryName
    ? `Items by ${series.categoryName}`
    : "Distribution";
}

export function ChartBlock({
  series,
  options,
}: {
  series: ChartSeries;
  options: ChartBlockOptions;
}) {
  const title = heading(options, series);

  if (series.empty || series.categories.length === 0) {
    return (
      <section className="r-section">
        <div className="r-kicker">{title}</div>
        <p className="r-chart-empty">No data to chart.</p>
      </section>
    );
  }

  // A one-slice ring and a one-bar bar chart are both anti-patterns: the number
  // IS the chart. Render the stat line instead.
  if (series.categories.length < 2) {
    const only = series.categories[0];
    return (
      <section className="r-section">
        <div className="r-kicker">{title}</div>
        <p className="r-chart-stat">
          <b>{only.value}</b> {only.value === 1 ? "item" : "items"} ·{" "}
          {only.label}
        </p>
      </section>
    );
  }

  if (options.variant === "bars") {
    return (
      <section className="r-section">
        <div className="r-kicker">{title}</div>
        <div className="r-chart r-chart-bars">
          <BarsChart categories={series.categories} />
        </div>
      </section>
    );
  }

  return (
    <section className="r-section">
      <div className="r-kicker">{title}</div>
      <div className="r-chart">
        <DonutChart categories={series.categories} total={series.total} />
        <ChartLegend categories={series.categories} />
      </div>
    </section>
  );
}
