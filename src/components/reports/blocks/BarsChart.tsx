// src/components/reports/blocks/BarsChart.tsx
// Plain HTML/CSS percentage widths — the same idiom GroupSummariesBlock already
// prints correctly. No SVG, no measurement, no client JS.
import type { ChartCategory } from "@/lib/reports/chart-data";
import { share } from "./ChartLegend";

export function BarsChart({ categories }: { categories: ChartCategory[] }) {
  const sum = categories.reduce((n, c) => n + c.value, 0);
  const max = categories.reduce((n, c) => Math.max(n, c.value), 0) || 1;
  return (
    <div>
      {categories.map((c) => (
        <div className="r-bar-row" key={c.key}>
          <span className="r-bar-name">{c.label}</span>
          <span className="r-bar-track">
            <span
              className="r-bar-fill"
              style={{
                width: `${(c.value / max) * 100}%`,
                background: c.color,
              }}
            />
          </span>
          <span className="r-bar-n">{c.value}</span>
          <span className="r-bar-p">{share(c.value, sum)}</span>
        </div>
      ))}
    </div>
  );
}
