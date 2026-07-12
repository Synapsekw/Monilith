"use client";

import { useState } from "react";
import type { Column, Group, Item } from "@/lib/boards/queries";
import type { BoardCache, CacheCellValue } from "@/lib/boards/cache";
import { NAME_FREEZE_EDGE } from "@/components/boards/SummaryRow";
import { RollupValueCell } from "@/components/boards/RollupValueCell";
import { cn } from "@/lib/utils";
import { ROW_HEIGHT } from "./shared";

/**
 * Read-only per-column rollup row shown under a collapsed group's header, so a
 * collapsed group summarizes all its items the same way a collapsed parent
 * summarizes its subitems (percent → averaged color bar, number → sum, etc.).
 * Computed client-side from already-loaded cell values — no extra round-trips.
 */
export function GroupRollupRow({
  group,
  items,
  columns,
  cellMap,
  cache,
  template,
}: {
  group: Group;
  items: Item[];
  columns: Column[];
  cellMap: Map<string, CacheCellValue["value"]>;
  cache: BoardCache;
  template: string;
}) {
  // Snapshot "now" for any running time-tracking entry (keeps render pure).
  const [nowMs] = useState(() => Date.now());
  return (
    <div
      className="bg-surface grid w-full border-b"
      style={{ height: ROW_HEIGHT, gridTemplateColumns: template }}
    >
      <div
        className={cn(
          "bg-surface text-muted-foreground sticky left-0 z-10 flex items-center px-3 text-xs",
          NAME_FREEZE_EDGE,
        )}
        style={{ boxShadow: `inset 3px 0 0 0 ${group.color}` }}
      >
        Average
      </div>
      {columns.map((col) => (
        <RollupValueCell
          key={col.id}
          col={col}
          items={items}
          cellMap={cellMap}
          cache={cache}
          nowMs={nowMs}
        />
      ))}
      {/* Two filler cells to keep the grid aligned with the created-by/created-at tracks */}
      <div aria-hidden />
      <div aria-hidden />
    </div>
  );
}
