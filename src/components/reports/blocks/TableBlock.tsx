// src/components/reports/blocks/TableBlock.tsx
import type { ReportBlock } from "@/lib/reports/config";
import type { ReportModel } from "@/lib/reports/shape";
import { CellContent } from "./CellContent";

const NUMERIC_KINDS = new Set(["numbers", "currency", "percent"]);

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
  const numCls = (kind: string) =>
    NUMERIC_KINDS.has(kind) ? "r-num" : undefined;

  return (
    <section className="r-section">
      <div className="r-kicker">Board detail</div>
      {model.groups.map((g) => (
        <div className="r-grp" key={g.group.id}>
          <div className="r-grp-head">
            <span
              className="r-grp-tick"
              style={{ background: g.group.color }}
            />
            <span className="r-grp-name">{g.group.name}</span>
            <span className="r-grp-meta">
              {g.rows.length} {g.rows.length === 1 ? "item" : "items"}
            </span>
          </div>
          <table className="r-table">
            <thead>
              <tr>
                <th>Item</th>
                {columns.map((c) => (
                  <th key={c.id} className={numCls(c.kind)}>
                    {c.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {g.rows.map((r) => (
                <tr key={r.item.id}>
                  <td className="r-cell-name">{r.item.name}</td>
                  {columns.map((c) => (
                    <td key={c.id} className={numCls(c.kind)}>
                      <CellContent cell={r.cells.get(c.id)} />
                    </td>
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
