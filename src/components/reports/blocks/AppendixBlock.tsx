// src/components/reports/blocks/AppendixBlock.tsx
import type { ReportModel, ReportRow } from "@/lib/reports/shape";

/** Flatten a group's rows (including nested subitems) into a flat list with a
 *  depth marker, so the appendix is a true full-data dump. */
function flatten(
  rows: ReportRow[],
  depth = 0,
): { row: ReportRow; depth: number }[] {
  return rows.flatMap((row) => [
    { row, depth },
    ...flatten(row.subitems, depth + 1),
  ]);
}

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
            flatten(g.rows).map(({ row, depth }) => (
              <tr
                key={row.item.id}
                className={depth > 0 ? "r-subrow" : undefined}
              >
                <td>{g.group.name}</td>
                <td
                  className="r-cell-name"
                  style={
                    depth > 0
                      ? { paddingLeft: `${9 + depth * 16}px` }
                      : undefined
                  }
                >
                  {depth > 0 ? <span className="r-sub-caret">↳ </span> : null}
                  {row.item.name}
                </td>
                {model.columns.map((c) => (
                  <td key={c.id}>{row.cells.get(c.id)?.text ?? ""}</td>
                ))}
              </tr>
            )),
          )}
        </tbody>
      </table>
    </section>
  );
}
