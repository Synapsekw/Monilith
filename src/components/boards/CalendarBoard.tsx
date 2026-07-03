"use client";

import { useState, useTransition, useMemo } from "react";
import { toast } from "sonner";
import { DndContext, type DragEndEvent } from "@dnd-kit/core";

import type { BoardPayload } from "@/lib/boards/queries";
import type { BoardCache } from "@/lib/boards/cache";
import { buildCellMap } from "@/lib/boards/cache";
import { useBoardCache } from "@/lib/boards/use-board-cache";
import { useBoardMutations } from "@/lib/boards/use-board-mutations";
import {
  onEventDropped,
  weekStartOnOrBefore,
  addDaysISO,
} from "@/lib/boards/calendar";
import { resolveDateColumn, itemDateRange } from "@/lib/boards/dates";
import { useTouchAwareSensors } from "@/lib/dnd/sensors";
import { updateBoardView } from "@/lib/boards/view-actions";
import { BoardHeader } from "@/components/boards/BoardHeader";
import type { BoardAccess, HeaderGrant } from "@/components/boards/BoardHeader";
import type { EditorMember } from "@/components/boards/cells/editors";
import {
  CalendarControls,
  type CalendarMode,
} from "@/components/boards/calendar/CalendarControls";
import { CalendarMonth } from "@/components/boards/calendar/CalendarMonth";
import { CalendarWeek } from "@/components/boards/calendar/CalendarWeek";
import { CalendarAgenda } from "@/components/boards/calendar/CalendarAgenda";
import type { ChipDragData } from "@/components/boards/calendar/EventBar";

function firstOfMonth(dateISO: string): string {
  const [y, m] = dateISO.split("-");
  return `${y}-${m}-01`;
}
function shiftMonth(monthISO: string, delta: number): string {
  const [y, m] = monthISO.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}
function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function monthLabel(monthISO: string): string {
  const [y, m] = monthISO.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
function weekLabel(weekStartISO: string): string {
  const end = addDaysISO(weekStartISO, 6);
  const f = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  return `${f(weekStartISO)} – ${f(end)}`;
}
function lastOfMonthISO(monthISO: string): string {
  const [y, m] = monthISO.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 0)); // day 0 of next month = last day
  return `${y}-${String(m).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/**
 * Open the item detail panel by setting `?item=<id>` via the History API — no
 * RSC navigation, so the board page's queries don't re-run (mirrors how
 * `BoardTable`/`ViewSwitcher` set their params). {@link BoardViews} reads the
 * param and renders the panel.
 */
function openItemPanel(itemId: string) {
  const url = new URL(window.location.href);
  url.searchParams.set("item", itemId);
  window.history.pushState({}, "", url);
}

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
  const [, startTransition] = useTransition();

  // The view config carries the persisted date column. Hold a local override so
  // switching the date column re-lays the calendar instantly (memoized over the
  // in-memory cache) with no `router.refresh()` refetch; persist in background.
  const selectedView = payload.views.find((v) => v.id === selectedViewId);
  const serverConfig = (selectedView?.config ?? null) as {
    date_column_id?: string | null;
  } | null;
  const serverDateColumnId = serverConfig?.date_column_id ?? null;

  const [dateColumnOverride, setDateColumnOverride] = useState<string | null>(
    serverDateColumnId,
  );
  // Reconcile if the server prop changes under us (adjust-state-during-render).
  const [syncedServerDateId, setSyncedServerDateId] =
    useState(serverDateColumnId);
  if (serverDateColumnId !== syncedServerDateId) {
    setSyncedServerDateId(serverDateColumnId);
    setDateColumnOverride(serverDateColumnId);
  }

  const dateColumn = resolveDateColumn(cache.columns, {
    date_column_id: dateColumnOverride,
  });
  const dateColumns = cache.columns.filter((c) => c.kind === "date");
  const statusColumn = useMemo(
    () => cache.columns.find((c) => c.kind === "status"),
    [cache.columns],
  );

  const [mode, setMode] = useState<CalendarMode>("month");
  const [cursorISO, setCursorISO] = useState<string>(() => {
    if (dateColumn) {
      const first = cache.cellValues.find(
        (cv) =>
          cv.column_id === dateColumn.id &&
          typeof (cv.value as Record<string, unknown>)?.date === "string",
      );
      const date = first ? (first.value as { date: string }).date : null;
      if (date) return date;
    }
    return todayISO();
  });

  const cellMap = useMemo(
    () => buildCellMap(cache.cellValues),
    [cache.cellValues],
  );

  const sensors = useTouchAwareSensors();

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
          groups={cache.groups.map((g) => ({ id: g.id, name: g.name }))}
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

  const resolvedDateColumn = dateColumn;
  const today = todayISO();
  const firstGroupId = cache.groups[0]?.id;

  const monthISO = firstOfMonth(cursorISO);
  const weekStartISO = weekStartOnOrBefore(cursorISO);
  const label =
    mode === "week" ? weekLabel(weekStartISO) : monthLabel(monthISO);

  function nav(delta: number) {
    setCursorISO((c) =>
      mode === "week"
        ? addDaysISO(c, delta * 7)
        : shiftMonth(firstOfMonth(c), delta),
    );
  }

  function handleDateColumnChange(columnId: string) {
    const previous = dateColumnOverride;
    // Apply immediately so the memoized re-layout happens this render — no refetch.
    setDateColumnOverride(columnId);
    // Persist in the background; on failure revert the override + surface it.
    startTransition(async () => {
      const res = await updateBoardView({
        viewId: selectedViewId,
        config: { date_column_id: columnId },
      });
      if (!res.ok) {
        setDateColumnOverride(previous);
        toast.error(
          "Couldn't change the date column — your change was undone.",
          {
            description: res.error,
          },
        );
      }
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

  const shared = {
    today,
    items: cache.items,
    cellValues: cache.cellValues,
    dateColumnId: resolvedDateColumn.id,
    statusColumn,
    cellMap,
    onOpenItem: openItemPanel,
  };

  return (
    <div className="flex h-full flex-col">
      <BoardHeader
        boardId={cache.board.id}
        boardName={cache.board.name}
        views={payload.views}
        selectedViewId={selectedViewId}
        columns={cache.columns}
        members={members}
        groups={cache.groups.map((g) => ({ id: g.id, name: g.name }))}
        access={access}
        grants={grants}
      />

      <CalendarControls
        mode={mode}
        onModeChange={setMode}
        label={label}
        onPrev={() => nav(-1)}
        onNext={() => nav(1)}
        onToday={() => setCursorISO(todayISO())}
        dateColumns={dateColumns}
        activeDateColumnId={resolvedDateColumn.id}
        onDateColumnChange={handleDateColumnChange}
      />

      {mode === "agenda" ? (
        <CalendarAgenda
          {...shared}
          fromISO={monthISO}
          toISO={lastOfMonthISO(monthISO)}
        />
      ) : (
        <DndContext
          id={`calendar-${selectedViewId}`}
          sensors={sensors}
          onDragEnd={handleDragEnd}
        >
          {mode === "week" ? (
            <CalendarWeek
              {...shared}
              weekStartISO={weekStartISO}
              onDayClick={handleDayClick}
            />
          ) : (
            <CalendarMonth
              {...shared}
              monthISO={monthISO}
              onDayClick={handleDayClick}
            />
          )}
        </DndContext>
      )}
    </div>
  );
}
