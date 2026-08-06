"use client";

import { useWidgetRows } from "@/lib/dashboards/use-widget-rows";
import { formatCell } from "@/lib/dashboards/list-rows";
import { ColorChip } from "@/components/ui/color-chip";
import type { CacheWidget } from "@/lib/dashboards/cache";

export function ListWidget({ widget }: { widget: CacheWidget }) {
  const { data, isLoading, isError } = useWidgetRows(widget.id);

  if (!widget.source_board_id)
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
        Pick a source board
      </div>
    );
  if (isLoading)
    return <div className="bg-muted/40 h-full animate-pulse rounded-md" />;
  if (isError || !data)
    return <div className="text-destructive text-sm">Failed to load</div>;
  if (data.rows.length === 0)
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
        No items
      </div>
    );

  // `truncate` (overflow:hidden + text-overflow:ellipsis + white-space:nowrap)
  // only ever fires when the element it's on has a DEFINITE width to overflow
  // against. The default `table-layout:auto` doesn't give cells one — it
  // sizes each column to its content's min-content width, and `white-space:
  // nowrap` makes that min-content width the entire unbroken line, so the
  // column just grows and the wrapper's `overflow-auto` becomes a horizontal
  // scrollbar instead of an ellipsis (see report-css.ts's `.r-table` comment,
  // which hits the identical problem in the PDF table and — because that
  // table's columns are caller-chosen and can't be evenly pre-sized — solves
  // it the other way, by bounding the source string instead). `table-fixed` +
  // a `<colgroup>` giving every column an equal, definite percentage width is
  // what makes `truncate` actually able to compute an overflow here.
  const colCount = data.columns.length + 1;
  const colWidth = `${100 / colCount}%`;

  return (
    <div className="h-full overflow-auto">
      <table className="w-full table-fixed text-sm">
        <colgroup>
          <col style={{ width: colWidth }} />
          {data.columns.map((c) => (
            <col key={c.id} style={{ width: colWidth }} />
          ))}
        </colgroup>
        <thead className="text-muted-foreground bg-card sticky top-0 border-b text-left text-xs">
          <tr>
            <th className="truncate px-2 py-1 font-medium">Item</th>
            {data.columns.map((c) => (
              <th key={c.id} className="truncate px-2 py-1 font-medium">
                {c.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row) => (
            <tr key={row.itemId} className="border-t">
              <td className="truncate px-2 py-1">{row.name}</td>
              {data.columns.map((c) => {
                const cell = formatCell(c, row.cells[c.id]);
                return (
                  <td key={c.id} className="truncate px-2 py-1">
                    {cell.color ? (
                      <ColorChip color={cell.color}>{cell.text}</ColorChip>
                    ) : (
                      <span className="text-muted-foreground" title={cell.text}>
                        {cell.text}
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
