// src/components/reports/blocks/TableBlock.tsx
import type { ReactElement } from "react";
import type { ReportBlock } from "@/lib/reports/config";
import type { ReportModel, ReportRow } from "@/lib/reports/shape";
import type { Column } from "@/lib/boards/queries";
import { CellContent } from "./CellContent";

const NUMERIC_KINDS = new Set(["numbers", "currency", "percent"]);
const numCls = (kind: string) =>
  NUMERIC_KINDS.has(kind) ? "r-num" : undefined;

/** Total rows a group renders, counting nested subitems. */
function countRows(rows: ReportRow[]): number {
  return rows.reduce((n, r) => n + 1 + countRows(r.subitems), 0);
}

/** Render a group's rows, recursing into subitems as indented rows so the data
 *  that lives on subitems (often the actual statuses) is visible. */
function renderRows(
  rows: ReportRow[],
  columns: Column[],
  depth: number,
): ReactElement[] {
  return rows.flatMap((r) => [
    <tr key={r.item.id} className={depth > 0 ? "r-subrow" : undefined}>
      <td
        className="r-cell-name"
        style={depth > 0 ? { paddingLeft: `${9 + depth * 16}px` } : undefined}
      >
        {depth > 0 ? <span className="r-sub-caret">↳ </span> : null}
        {r.item.name}
      </td>
      {columns.map((c) => (
        <td key={c.id} className={numCls(c.kind)}>
          <CellContent cell={r.cells.get(c.id)} />
        </td>
      ))}
    </tr>,
    ...renderRows(r.subitems, columns, depth + 1),
  ]);
}

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
      <div className="r-kicker">Board detail</div>
      {model.groups.map((g) => {
        const total = countRows(g.rows);
        return (
          <div className="r-grp" key={g.group.id}>
            <div className="r-grp-head">
              <span
                className="r-grp-tick"
                style={{ background: g.group.color }}
              />
              <span className="r-grp-name">{g.group.name}</span>
              <span className="r-grp-meta">
                {total} {total === 1 ? "item" : "items"}
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
              <tbody>{renderRows(g.rows, columns, 0)}</tbody>
            </table>
          </div>
        );
      })}
    </section>
  );
}
