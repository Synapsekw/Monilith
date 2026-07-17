// src/components/reports/blocks/TableBlock.tsx
import type { ReportBlock } from "@/lib/reports/config";
import type { ReportModel } from "@/lib/reports/shape";
export function TableBlock({
  model,
  options,
}: {
  model: ReportModel;
  options: Extract<ReportBlock, { type: "table" }>["options"];
}) {
  // null columnIds = all columns (spec default). Otherwise the curated subset.
  const columns = options.columnIds
    ? model.columns.filter((c) => options.columnIds!.includes(c.id))
    : model.columns;
  return (
    <section className="r-section">
      {model.groups.map((g) => (
        <div key={g.group.id}>
          <div className="r-group-head" style={{ color: g.group.color }}>
            {g.group.name}
          </div>
          <table className="r-table">
            <thead>
              <tr>
                <th>Item</th>
                {columns.map((c) => (
                  <th key={c.id}>{c.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {g.rows.map((r) => (
                <tr key={r.item.id}>
                  <td>{r.item.name}</td>
                  {columns.map((c) => (
                    <td key={c.id}>{r.cells.get(c.id) ?? ""}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </section>
  );
}
