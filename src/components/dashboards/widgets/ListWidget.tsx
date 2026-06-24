"use client";

import { useWidgetRows } from "@/lib/dashboards/use-widget-rows";
import { formatCell } from "@/lib/dashboards/list-rows";
import type { CacheWidget } from "@/lib/dashboards/cache";

export function ListWidget({ widget }: { widget: CacheWidget }) {
  const { data, isLoading, isError } = useWidgetRows(
    widget.id,
    widget.config as Record<string, unknown>,
  );

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

  return (
    <div className="h-full overflow-auto">
      <table className="w-full text-sm">
        <thead className="text-muted-foreground bg-card sticky top-0 border-b text-left text-xs">
          <tr>
            <th className="px-2 py-1 font-medium">Item</th>
            {data.columns.map((c) => (
              <th key={c.id} className="px-2 py-1 font-medium">
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
                  <td key={c.id} className="px-2 py-1">
                    {cell.color ? (
                      <span
                        className="inline-block rounded px-1.5 py-0.5 text-xs font-medium text-white"
                        style={{ backgroundColor: cell.color }}
                      >
                        {cell.text}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">{cell.text}</span>
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
