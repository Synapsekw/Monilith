"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import type { BoardCache, CacheColumn } from "@/lib/boards/cache";
import { addDaysISO, layOutWeek } from "@/lib/boards/calendar";
import { itemDateRange } from "@/lib/boards/dates";
import { EventBar } from "./EventBar";

type CellMap = Map<string, BoardCache["cellValues"][number]["value"]>;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function CalendarWeek({
  weekStartISO,
  today,
  items,
  cellValues,
  dateColumnId,
  statusColumn,
  cellMap,
  onDayClick,
  onOpenItem,
}: {
  weekStartISO: string;
  today: string;
  items: { id: string; name: string }[];
  cellValues: BoardCache["cellValues"];
  dateColumnId: string;
  statusColumn: CacheColumn | undefined;
  cellMap: CellMap;
  onDayClick: (dayISO: string) => void;
  onOpenItem?: (itemId: string) => void;
}) {
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDaysISO(weekStartISO, i)),
    [weekStartISO],
  );
  const placed = useMemo(
    () => layOutWeek(weekStartISO, items, cellValues, dateColumnId),
    [weekStartISO, items, cellValues, dateColumnId],
  );
  const laneCount = placed.reduce((m, p) => Math.max(m, p.lane + 1), 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto px-4 py-3">
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-t-md border">
        {days.map((iso, i) => (
          <div
            key={iso}
            className={cn(
              "border-r p-2 last:border-r-0",
              iso === today && "bg-primary/8",
            )}
          >
            <div className="text-muted-foreground text-[10px] font-semibold uppercase">
              {WEEKDAYS[i]}
            </div>
            <div
              className={cn(
                "text-base font-semibold tabular-nums",
                iso === today && "text-primary",
              )}
            >
              {Number(iso.split("-")[2])}
            </div>
          </div>
        ))}
      </div>

      <div
        className="relative grid grid-cols-7 rounded-b-md border border-t-0"
        style={{ minHeight: `${Math.max(laneCount, 4) * 26 + 16}px` }}
      >
        {days.map((iso) => (
          <div
            key={iso}
            role="button"
            tabIndex={0}
            aria-label={`Add item on ${iso}`}
            onClick={() => onDayClick(iso)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onDayClick(iso);
              }
            }}
            className={cn(
              "hover:bg-accent/10 cursor-pointer border-r last:border-r-0",
              iso === today && "bg-primary/8",
            )}
          />
        ))}
        <div
          className="pointer-events-none absolute inset-x-1.5 top-2 grid grid-cols-7 gap-px"
          style={{ gridAutoRows: "24px" }}
        >
          {placed.map((iv) => {
            const range = itemDateRange(iv.itemId, cellValues, dateColumnId);
            return (
              <div
                key={iv.itemId}
                className="pointer-events-auto min-w-0"
                style={{
                  gridColumn: `${iv.startCol} / ${iv.endCol + 1}`,
                  gridRow: iv.lane + 1,
                }}
              >
                <EventBar
                  interval={iv}
                  fromDayISO={range?.start ?? weekStartISO}
                  dateColumnId={dateColumnId}
                  statusColumn={statusColumn}
                  cellMap={cellMap}
                  onOpen={onOpenItem}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
