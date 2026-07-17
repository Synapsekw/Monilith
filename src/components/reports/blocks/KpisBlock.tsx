// src/components/reports/blocks/KpisBlock.tsx
import type { Kpis } from "@/lib/reports/shape";
export function KpisBlock({ kpis }: { kpis: Kpis }) {
  return (
    <section className="r-section">
      <div className="r-kicker">Key metrics</div>
      <div className="r-kpis">
        <div className="r-kpi">
          <div className="n">{kpis.itemCount}</div>
          <div className="l">Items</div>
        </div>
        <div className="r-kpi">
          <div className="n">{kpis.percentComplete}%</div>
          <div className="l">Complete</div>
        </div>
        <div className="r-kpi">
          <div className="n">{kpis.overdueCount}</div>
          <div className="l">Overdue</div>
        </div>
      </div>
    </section>
  );
}
