"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import type { BoardCache, CacheColumn } from "@/lib/boards/cache";
import {
  buildCalendarMonth,
  layOutWeek,
  type PlacedInterval,
} from "@/lib/boards/calendar";
import { itemDateRange } from "@/lib/boards/dates";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { EventBar } from "./EventBar";

export const MONTH_LANE_CAP = 3;

type CellMap = Map<string, BoardCache["cellValues"][number]["value"]>;

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function CalendarMonth({
  monthISO,
  today,
  items,
  cellValues,
  dateColumnId,
  statusColumn,
  cellMap,
  onDayClick,
  onOpenItem,
}: {
  monthISO: string;
  today: string;
  items: { id: string; name: string }[];
  cellValues: BoardCache["cellValues"];
  dateColumnId: string;
  statusColumn: CacheColumn | undefined;
  cellMap: CellMap;
  onDayClick: (dayISO: string) => void;
  onOpenItem?: (itemId: string) => void;
}) {
  const month = useMemo(
    () => buildCalendarMonth(monthISO, items, cellValues, dateColumnId),
    [monthISO, items, cellValues, dateColumnId],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto px-4 py-3">
      <div className="mb-1 grid grid-cols-7 gap-px">
        {WEEKDAYS.map((d) => (
          <div
            key={d}
            className="text-muted-foreground px-1 text-[10px] font-semibold tracking-wide uppercase"
          >
            {d}
          </div>
        ))}
      </div>

      <div className="bg-border flex flex-1 flex-col gap-px rounded-md border">
        {month.weeks.map((week) => {
          const weekStartISO = week[0].dateISO;
          const placed = layOutWeek(
            weekStartISO,
            items,
            cellValues,
            dateColumnId,
          );
          const visible = placed.filter((p) => p.lane < MONTH_LANE_CAP);
          // Hidden interval count per column (1..7).
          const overflow = Array.from({ length: 7 }, (_, c) =>
            placed.filter(
              (p) =>
                p.lane >= MONTH_LANE_CAP &&
                p.startCol <= c + 1 &&
                p.endCol >= c + 1,
            ),
          );
          return (
            <div
              key={weekStartISO}
              className="relative grid grid-cols-7 gap-px"
            >
              {/* Day cells */}
              {week.map((day, dayIdx) => {
                const count = day.events.length;
                const isWeekend = dayIdx === 0 || dayIdx === 6;
                return (
                  <div
                    key={day.dateISO}
                    role="button"
                    tabIndex={0}
                    aria-label={`Add item on ${day.dateISO}`}
                    onClick={() => onDayClick(day.dateISO)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onDayClick(day.dateISO);
                      }
                    }}
                    className={cn(
                      "bg-surface hover:bg-accent/20 flex min-h-[6.5rem] cursor-pointer flex-col p-1.5",
                      !day.inMonth && "bg-surface-muted opacity-50",
                      day.inMonth && isWeekend && "bg-surface-muted/40",
                      day.dateISO === today &&
                        "ring-primary/50 ring-1 ring-inset",
                    )}
                  >
                    <div className="flex items-center justify-end">
                      <span
                        className={cn(
                          "text-[11px] tabular-nums",
                          day.dateISO === today
                            ? "text-primary font-bold"
                            : "text-muted-foreground",
                        )}
                      >
                        {Number(day.dateISO.split("-")[2])}
                      </span>
                    </div>
                    {count > 0 && (
                      <span
                        aria-hidden
                        className="bg-muted-foreground mt-0.5 h-0.5 rounded-full"
                        style={{ opacity: Math.min(1, 0.25 + count * 0.18) }}
                      />
                    )}
                  </div>
                );
              })}

              {/* Lane overlay: bars positioned by grid column/row. */}
              <div
                className="pointer-events-none absolute inset-x-1.5 top-7 grid grid-cols-7 gap-px"
                style={{ gridAutoRows: "20px" }}
              >
                {visible.map((iv) => (
                  <div
                    key={`${iv.itemId}-${weekStartISO}`}
                    className="pointer-events-auto min-w-0"
                    style={{
                      gridColumn: `${iv.startCol} / ${iv.endCol + 1}`,
                      gridRow: iv.lane + 1,
                    }}
                  >
                    <BarForDay
                      interval={iv}
                      weekStartISO={weekStartISO}
                      cellValues={cellValues}
                      dateColumnId={dateColumnId}
                      statusColumn={statusColumn}
                      cellMap={cellMap}
                      onOpenItem={onOpenItem}
                    />
                  </div>
                ))}
              </div>

              {/* "+N more" row beneath the cap. */}
              <div
                className="pointer-events-none absolute inset-x-1.5 grid grid-cols-7 gap-px"
                style={{ top: `calc(1.75rem + ${MONTH_LANE_CAP * 20}px)` }}
              >
                {overflow.map((hidden, c) =>
                  hidden.length > 0 ? (
                    <DayMorePopover
                      key={c}
                      colIndex={c}
                      hidden={hidden}
                      onOpenItem={onOpenItem}
                    />
                  ) : (
                    <span key={c} />
                  ),
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Resolve the drop-anchor day for a bar (its real start day — needed for the
 * drag delta math in `onEventDropped`) and render it. `itemDateRange` needs the
 * raw `CacheCellValue[]`, so `cellValues` is threaded in alongside the value map.
 */
function BarForDay({
  interval,
  weekStartISO,
  cellValues,
  dateColumnId,
  statusColumn,
  cellMap,
  onOpenItem,
}: {
  interval: PlacedInterval;
  weekStartISO: string;
  cellValues: BoardCache["cellValues"];
  dateColumnId: string;
  statusColumn: CacheColumn | undefined;
  cellMap: CellMap;
  onOpenItem?: (itemId: string) => void;
}) {
  const range = itemDateRange(interval.itemId, cellValues, dateColumnId);
  const fromDayISO = range?.start ?? weekStartISO;
  return (
    <EventBar
      interval={interval}
      fromDayISO={fromDayISO}
      weekStartISO={weekStartISO}
      dateColumnId={dateColumnId}
      statusColumn={statusColumn}
      cellMap={cellMap}
      onOpen={onOpenItem}
    />
  );
}

function DayMorePopover({
  colIndex,
  hidden,
  onOpenItem,
}: {
  colIndex: number;
  hidden: PlacedInterval[];
  onOpenItem?: (itemId: string) => void;
}) {
  return (
    <div
      style={{ gridColumn: `${colIndex + 1} / ${colIndex + 2}` }}
      className="pointer-events-auto"
    >
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            onClick={(e) => e.stopPropagation()}
            className="text-muted-foreground hover:bg-accent w-full rounded px-1 text-left text-[10px]"
          >
            +{hidden.length} more
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-56 p-1">
          <ul className="flex flex-col">
            {hidden.map((iv) => (
              <li key={iv.itemId}>
                <button
                  type="button"
                  onClick={() => onOpenItem?.(iv.itemId)}
                  className="hover:bg-accent w-full truncate rounded px-2 py-1 text-left text-sm"
                >
                  {iv.name}
                </button>
              </li>
            ))}
          </ul>
        </PopoverContent>
      </Popover>
    </div>
  );
}
