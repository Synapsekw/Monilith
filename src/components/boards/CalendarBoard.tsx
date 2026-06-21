"use client";

import { useState, useTransition, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  useDraggable,
  useDroppable,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";

import { cn } from "@/lib/utils";
import type { BoardPayload } from "@/lib/boards/queries";
import type { BoardCache, CacheColumn } from "@/lib/boards/cache";
import { buildCellMap, cellKey } from "@/lib/boards/cache";
import type { Json } from "@/types/database.types";
import { useBoardCache } from "@/lib/boards/use-board-cache";
import { useBoardMutations } from "@/lib/boards/use-board-mutations";
import {
  buildCalendarMonth,
  onEventDropped,
  type CalendarEvent,
} from "@/lib/boards/calendar";
import { resolveDateColumn, itemDateRange } from "@/lib/boards/dates";
import { updateBoardView } from "@/lib/boards/view-actions";
import { BoardHeader } from "@/components/boards/BoardHeader";
import type { BoardAccess, HeaderGrant } from "@/components/boards/BoardHeader";
import { CellRenderer } from "@/components/boards/cells";
import type { EditorMember } from "@/components/boards/cells/editors";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Settings = Record<string, unknown>;

type ChipDragData = {
  itemId: string;
  fromDayISO: string;
  dateColumnId: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Return YYYY-MM-DD for the first day of the month containing dateISO. */
function firstOfMonth(dateISO: string): string {
  const [y, m] = dateISO.split("-");
  return `${y}-${m}-01`;
}

/** Add/subtract whole months by re-computing the date from year + month. */
function shiftMonth(monthISO: string, delta: number): string {
  const [y, m] = monthISO.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  const ny = d.getUTCFullYear();
  const nm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${ny}-${nm}-01`;
}

/** Today as YYYY-MM-DD (client-side; fine in a "use client" component). */
function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Human-readable month label, e.g. "June 2026". */
function monthLabel(monthISO: string): string {
  const [y, m] = monthISO.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

// ---------------------------------------------------------------------------
// CalendarBoard (main export)
// ---------------------------------------------------------------------------

export function CalendarBoard({
  payload,
  selectedViewId,
  members = [],
  access = "owner",
  grants = [],
}: {
  payload: BoardPayload;
  members?: EditorMember[];
  selectedViewId: string;
  access?: BoardAccess;
  grants?: HeaderGrant[];
}) {
  const { data: cache } = useBoardCache(
    payload.board.id,
    payload as unknown as BoardCache,
  );
  const { setCell, addItem } = useBoardMutations(payload.board.id);

  const router = useRouter();

  // Resolve the selected view and its config (payload.views, same as KanbanBoard).
  const selectedView = payload.views.find((v) => v.id === selectedViewId);

  const config = (selectedView?.config ?? null) as {
    date_column_id?: string | null;
  } | null;

  const dateColumn = resolveDateColumn(cache.columns, config);

  // Date column picker — only available date columns.
  const dateColumns = cache.columns.filter((c) => c.kind === "date");

  // Determine initial month: first dated item's month, else current month.
  const [monthISO, setMonthISO] = useState<string>(() => {
    if (dateColumn) {
      const first = cache.cellValues.find(
        (cv) =>
          cv.column_id === dateColumn.id &&
          typeof (cv.value as Record<string, unknown>)?.date === "string",
      );
      const date = first
        ? ((cv: typeof first) => (cv.value as { date: string }).date)(first)
        : null;
      if (date) return firstOfMonth(date);
    }
    return firstOfMonth(todayISO());
  });

  const [, startTransition] = useTransition();

  // DnD sensors.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  // O(1) lookup map for cell values — built once per cellValues reference change.
  // Placed before early return so hook ordering is unconditional.
  const cellMap = useMemo(
    () => buildCellMap(cache.cellValues),
    [cache.cellValues],
  );

  // Month grid: bucket items into calendar days. Only valid when dateColumn exists.
  const calendarMonth = useMemo(() => {
    if (!dateColumn) return null;
    return buildCalendarMonth(
      monthISO,
      cache.items,
      cache.cellValues,
      dateColumn.id,
    );
  }, [dateColumn, monthISO, cache.items, cache.cellValues]);

  // Unscheduled items: those with no date cell for the active date column.
  const unscheduledItems = useMemo(() => {
    if (!dateColumn) return [];
    return cache.items.filter((item) => {
      const range = itemDateRange(item.id, cache.cellValues, dateColumn.id);
      return range === null;
    });
  }, [dateColumn, cache.items, cache.cellValues]);

  const statusColumn = useMemo(
    () => cache.columns.find((c) => c.kind === "status"),
    [cache.columns],
  );

  // Empty state: no date column.
  if (!dateColumn) {
    return (
      <div className="flex h-full flex-col">
        <BoardHeader
          boardId={cache.board.id}
          boardName={cache.board.name}
          views={payload.views}
          selectedViewId={selectedViewId}
          columns={cache.columns}
          members={members}
          access={access}
          grants={grants}
        />
        <div className="flex flex-1 items-center justify-center p-8">
          <p className="text-muted-foreground text-sm">
            Add a Date column to use the Calendar view.
          </p>
        </div>
      </div>
    );
  }

  // dateColumn is non-null past this point (early return above).
  const resolvedDateColumn = dateColumn;

  const today = todayISO();
  const firstGroupId = cache.groups[0]?.id;

  function handleDateColumnChange(columnId: string) {
    startTransition(async () => {
      await updateBoardView({
        viewId: selectedViewId,
        config: { date_column_id: columnId },
      });
      router.refresh();
    });
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;
    const data = active.data.current as ChipDragData | undefined;
    if (!data) return;
    const toDayISO = over.id as string;
    if (toDayISO === data.fromDayISO) return;
    const range = itemDateRange(
      data.itemId,
      cache.cellValues,
      data.dateColumnId,
    );
    if (!range) return;
    onEventDropped(
      data.itemId,
      data.fromDayISO,
      toDayISO,
      range,
      data.dateColumnId,
      setCell as Parameters<typeof onEventDropped>[5],
    );
  }

  function handleDayClick(dayISO: string) {
    if (!firstGroupId) return;
    addItem(
      { groupId: firstGroupId, name: "New item" },
      {
        onSuccess: (item) => {
          setCell({
            itemId: item.id,
            columnId: resolvedDateColumn.id,
            value: { date: dayISO },
          });
        },
      },
    );
  }

  const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <div className="flex h-full flex-col">
      <BoardHeader
        boardId={cache.board.id}
        boardName={cache.board.name}
        views={payload.views}
        selectedViewId={selectedViewId}
        columns={cache.columns}
        members={members}
        access={access}
        grants={grants}
      />

      {/* Controls bar */}
      <div className="flex items-center gap-3 border-b px-6 py-2">
        {/* Month nav */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Previous month"
            onClick={() => setMonthISO((m) => shiftMonth(m, -1))}
            className="text-muted-foreground hover:bg-accent flex h-7 w-7 items-center justify-center rounded-md transition-colors"
          >
            <ChevronLeft className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => setMonthISO(firstOfMonth(todayISO()))}
            className="text-muted-foreground hover:bg-accent rounded-md border px-2.5 py-1 text-xs font-medium transition-colors"
          >
            Today
          </button>
          <button
            type="button"
            aria-label="Next month"
            onClick={() => setMonthISO((m) => shiftMonth(m, 1))}
            className="text-muted-foreground hover:bg-accent flex h-7 w-7 items-center justify-center rounded-md transition-colors"
          >
            <ChevronRight className="size-4" aria-hidden />
          </button>
        </div>

        <span className="text-sm font-semibold tracking-tight">
          {monthLabel(monthISO)}
        </span>

        <div className="ml-auto flex items-center gap-2">
          {/* Date column picker */}
          <label
            htmlFor="cal-date-column"
            className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium"
            aria-label="Date column"
          >
            <CalendarDays className="size-3.5" aria-hidden />
            Date by
          </label>
          <select
            id="cal-date-column"
            aria-label="Date column"
            value={resolvedDateColumn.id}
            onChange={(e) => handleDateColumnChange(e.target.value)}
            className="bg-surface focus-visible:ring-ring rounded-md border px-2 py-1 text-sm focus-visible:ring-2 focus-visible:outline-none"
          >
            {dateColumns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Grid */}
      <DndContext
        id={`calendar-${selectedViewId}`}
        sensors={sensors}
        onDragEnd={handleDragEnd}
      >
        <div className="flex min-h-0 flex-1 flex-col overflow-auto px-4 py-3">
          {/* Weekday header row */}
          <div className="mb-1 grid grid-cols-7 gap-1">
            {WEEKDAYS.map((d) => (
              <div
                key={d}
                className="text-muted-foreground px-1 text-xs font-semibold tracking-wide uppercase"
              >
                {d}
              </div>
            ))}
          </div>

          {/* 6-week grid */}
          <div className="grid flex-1 grid-cols-7 grid-rows-6 gap-1">
            {calendarMonth!.weeks.flatMap((week) =>
              week.map((day) => (
                <CalendarDayCell
                  key={day.dateISO}
                  dateISO={day.dateISO}
                  inMonth={day.inMonth}
                  isToday={day.dateISO === today}
                  events={day.events}
                  dateColumnId={resolvedDateColumn.id}
                  statusColumn={statusColumn}
                  cellMap={cellMap}
                  onDayClick={handleDayClick}
                />
              )),
            )}
          </div>
        </div>
      </DndContext>

      {/* Unscheduled section */}
      <UnscheduledSection items={unscheduledItems} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// CalendarDayCell
// ---------------------------------------------------------------------------

const MAX_VISIBLE_EVENTS = 3;

function CalendarDayCell({
  dateISO,
  inMonth,
  isToday,
  events,
  dateColumnId,
  statusColumn,
  cellMap,
  onDayClick,
}: {
  dateISO: string;
  inMonth: boolean;
  isToday: boolean;
  events: CalendarEvent[];
  dateColumnId: string;
  statusColumn: CacheColumn | undefined;
  cellMap: Map<string, BoardCache["cellValues"][number]["value"]>;
  onDayClick: (dayISO: string) => void;
}) {
  const { setNodeRef: dropRef, isOver } = useDroppable({ id: dateISO });
  const dayNum = Number(dateISO.split("-")[2]);
  const overflow = events.length - MAX_VISIBLE_EVENTS;

  return (
    <div
      ref={dropRef}
      onClick={() => onDayClick(dateISO)}
      role="button"
      tabIndex={0}
      aria-label={`Add item on ${dateISO}`}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onDayClick(dateISO);
        }
      }}
      className={cn(
        "bg-surface flex min-h-[5rem] flex-col overflow-hidden rounded-md border p-1.5 transition-colors",
        !inMonth && "bg-surface-muted opacity-50",
        isOver && "ring-ring ring-2",
        isToday && "border-primary/60",
        "hover:bg-accent/20 cursor-pointer",
      )}
    >
      {/* Day number */}
      <span
        className={cn(
          "mb-1 inline-flex h-5 w-5 items-center justify-center rounded-full text-[11.5px]",
          isToday
            ? "bg-primary text-primary-foreground font-bold"
            : "text-muted-foreground",
        )}
      >
        {dayNum}
      </span>

      {/* Event chips */}
      <div className="flex flex-col gap-0.5 overflow-hidden">
        {events.slice(0, MAX_VISIBLE_EVENTS).map((event) => (
          <EventChip
            key={`${event.itemId}-${dateISO}`}
            event={event}
            fromDayISO={dateISO}
            dateColumnId={dateColumnId}
            statusColumn={statusColumn}
            cellMap={cellMap}
          />
        ))}
        {overflow > 0 && (
          <span className="text-muted-foreground px-1 text-[10px]">
            +{overflow} more
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// EventChip (draggable)
// ---------------------------------------------------------------------------

function EventChip({
  event,
  fromDayISO,
  dateColumnId,
  statusColumn,
  cellMap,
}: {
  event: CalendarEvent;
  fromDayISO: string;
  dateColumnId: string;
  statusColumn: CacheColumn | undefined;
  cellMap: Map<string, BoardCache["cellValues"][number]["value"]>;
}) {
  const dragData: ChipDragData = {
    itemId: event.itemId,
    fromDayISO,
    dateColumnId,
  };
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: `${event.itemId}-${fromDayISO}`, data: dragData });

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  const statusValue = statusColumn
    ? (cellMap.get(cellKey(event.itemId, statusColumn.id)) ?? null)
    : null;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "bg-surface shadow-card flex cursor-grab items-center gap-1 truncate rounded px-1.5 py-0.5 text-left text-[11px] font-medium",
        "focus-visible:ring-ring border hover:opacity-90 focus-visible:ring-2 focus-visible:outline-none",
        isDragging && "opacity-50",
      )}
    >
      <span className="truncate">{event.name}</span>
      {statusColumn && (
        <span className="shrink-0">
          <CellRenderer
            kind={statusColumn.kind}
            value={statusValue as Json}
            settings={(statusColumn.settings ?? {}) as Settings}
          />
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// UnscheduledSection
// ---------------------------------------------------------------------------

function UnscheduledSection({
  items,
}: {
  items: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);

  if (items.length === 0) return null;

  return (
    <div className="border-t">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="text-muted-foreground hover:bg-accent flex w-full items-center gap-2 px-6 py-2 text-sm font-medium transition-colors"
      >
        <span>Unscheduled ({items.length})</span>
        <ChevronRight
          aria-hidden
          className={cn("size-3.5 transition-transform", open && "rotate-90")}
        />
      </button>
      <ul hidden={!open} aria-hidden={!open} className="border-t px-6 py-2">
        {items.map((item) => (
          <li key={item.id} className="text-foreground truncate py-0.5 text-sm">
            {item.name}
          </li>
        ))}
      </ul>
    </div>
  );
}
