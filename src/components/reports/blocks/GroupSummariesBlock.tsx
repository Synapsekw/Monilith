// src/components/reports/blocks/GroupSummariesBlock.tsx
import type { GroupSummary } from "@/lib/reports/shape";
export function GroupSummariesBlock({
  summaries,
}: {
  summaries: GroupSummary[];
}) {
  return (
    <section className="r-section">
      <div className="r-kicker">Group progress</div>
      {summaries.map((s) => (
        <div className="r-gs-row" key={s.group.id}>
          <span className="r-gs-name">{s.group.name}</span>
          <span className="r-gs-track">
            <span
              className="r-gs-fill"
              style={{ width: `${s.percentComplete}%` }}
            />
          </span>
          <span className="r-gs-pct">{s.percentComplete}%</span>
        </div>
      ))}
    </section>
  );
}
