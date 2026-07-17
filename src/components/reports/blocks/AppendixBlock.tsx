// src/components/reports/blocks/AppendixBlock.tsx
import type { ReportModel } from "@/lib/reports/shape";
export function AppendixBlock({ model }: { model: ReportModel }) {
  return (
    <section className="r-section">
      <div className="r-kicker">Appendix — full data</div>
      <table className="r-table">
        <thead>
          <tr>
            <th>Group</th>
            <th>Item</th>
            {model.columns.map((c) => (
              <th key={c.id}>{c.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {model.groups.flatMap((g) =>
            g.rows.map((r) => (
              <tr key={r.item.id}>
                <td>{g.group.name}</td>
                <td className="r-cell-name">{r.item.name}</td>
                {model.columns.map((c) => (
                  <td key={c.id}>{r.cells.get(c.id)?.text ?? ""}</td>
                ))}
              </tr>
            )),
          )}
        </tbody>
      </table>
    </section>
  );
}
