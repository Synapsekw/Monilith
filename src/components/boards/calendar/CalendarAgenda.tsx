"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import type { BoardCache, CacheColumn } from "@/lib/boards/cache";
import { cellKey } from "@/lib/boards/cache";
import type { Json } from "@/types/database.types";
import { agendaGroups } from "@/lib/boards/calendar-agenda";
import { CellRenderer } from "@/components/boards/cells";

type CellMap = Map<string, BoardCache["cellValues"][number]["value"]>;

function fmt(iso: string): string {
  // UTC formatting keeps it deterministic and free of TZ drift.
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
function weekday(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    timeZone: "UTC",
  });
}

export function CalendarAgenda({
  fromISO,
  toISO,
  today,
  items,
  cellValues,
  dateColumnId,
  statusColumn,
  cellMap,
  onItemTap,
}: {
  fromISO: string;
  toISO: string;
  today: string;
  items: { id: string; name: string }[];
  cellValues: BoardCache["cellValues"];
  dateColumnId: string;
  statusColumn: CacheColumn | undefined;
  cellMap: CellMap;
  /** Tap on an agenda row — carries the row's rect so the board can anchor
   * the quick-edit peek. */
  onItemTap?: (itemId: string, anchorRect: DOMRect) => void;
}) {
  const groups = useMemo(
    () => agendaGroups(fromISO, toISO, items, cellValues, dateColumnId),
    [fromISO, toISO, items, cellValues, dateColumnId],
  );

  if (groups.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <p className="text-muted-foreground text-sm">
          Nothing scheduled this period.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
      <div className="overflow-hidden rounded-md border">
        {groups.map((group) => (
          <div
            key={group.dateISO}
            className={cn(
              "grid grid-cols-[88px_1fr] border-b last:border-b-0",
              group.dateISO === today && "bg-primary/8",
            )}
          >
            <div className="border-r p-3">
              <div className="text-muted-foreground text-[10px] font-semibold uppercase">
                {weekday(group.dateISO)}
              </div>
              <div
                className={cn(
                  "text-xl font-semibold tabular-nums",
                  group.dateISO === today && "text-primary",
                )}
              >
                {Number(group.dateISO.split("-")[2])}
              </div>
            </div>
            <ul className="flex flex-col p-1.5">
              {group.items.map((item) => {
                const isSpan = item.range.end !== item.range.start;
                const statusValue = statusColumn
                  ? (cellMap.get(cellKey(item.itemId, statusColumn.id)) ?? null)
                  : null;
                return (
                  <li key={item.itemId}>
                    <button
                      type="button"
                      onClick={(e) =>
                        onItemTap?.(
                          item.itemId,
                          e.currentTarget.getBoundingClientRect(),
                        )
                      }
                      className="hover:bg-accent flex w-full items-center gap-2 rounded px-2 py-1.5 text-left pointer-coarse:min-h-11"
                    >
                      <span className="flex-1 truncate text-sm">
                        {item.name}
                      </span>
                      {isSpan && (
                        <span className="text-muted-foreground bg-surface-muted rounded-full border px-2 py-0.5 text-[10px]">
                          {fmt(item.range.start)} – {fmt(item.range.end)}
                        </span>
                      )}
                      {statusColumn && (
                        <CellRenderer
                          kind={statusColumn.kind}
                          value={statusValue as Json}
                          settings={
                            (statusColumn.settings ?? {}) as Record<
                              string,
                              unknown
                            >
                          }
                        />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
