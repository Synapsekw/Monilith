// src/components/reports/blocks/ChartLegend.tsx
import type { ChartCategory } from "@/lib/reports/chart-data";

export function share(value: number, sum: number): string {
  return sum > 0 ? `${Math.round((value / sum) * 100)}%` : "0%";
}

export function ChartLegend({ categories }: { categories: ChartCategory[] }) {
  const sum = categories.reduce((n, c) => n + c.value, 0);
  return (
    <div className="r-chart-legend">
      {categories.map((c) => (
        <div className="r-lg-row" key={c.key}>
          <span className="r-lg-sw" style={{ background: c.color }} />
          <span>{c.label}</span>
          <span className="r-lg-n">{c.value}</span>
          <span className="r-lg-p">{share(c.value, sum)}</span>
        </div>
      ))}
    </div>
  );
}
