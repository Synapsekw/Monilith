// src/components/reports/blocks/GroupSummariesBlock.tsx
import type { GroupSummary } from "@/lib/reports/shape";
export function GroupSummariesBlock({
  summaries,
}: {
  summaries: GroupSummary[];
}) {
  return (
    <section className="r-section">
      <div className="r-kicker">Group summaries</div>
      <table className="r-table">
        <thead>
          <tr>
            <th>Group</th>
            <th>Items</th>
            <th>Complete</th>
          </tr>
        </thead>
        <tbody>
          {summaries.map((s) => (
            <tr key={s.group.id}>
              <td>{s.group.name}</td>
              <td>{s.count}</td>
              <td>{s.percentComplete}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
