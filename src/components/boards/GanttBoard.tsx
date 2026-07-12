"use client";

import { useState, useTransition, useMemo } from "react";
import { DndContext, type DragEndEvent } from "@dnd-kit/core";
import { CalendarDays, GanttChartSquare } from "lucide-react";

import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useTouchAwareSensors } from "@/lib/dnd/sensors";
import type { BoardPayload } from "@/lib/boards/queries";
import type { BoardCache, CacheDependency } from "@/lib/boards/cache";
import { buildCellMap, cellKey } from "@/lib/boards/cache";
import { buildDependentsCountMap } from "@/lib/boards/priority";
import { useBoardCache } from "@/lib/boards/use-board-cache";
import { useBoardMutations } from "@/lib/boards/use-board-mutations";
import {
  buildGanttRows,
  detectViolations,
  onBarMoved,
  onBarResized,
  timelineDayCount,
  type GanttRow,
} from "@/lib/boards/gantt";
import { itemDateRange, defaultTimelineColumns } from "@/lib/boards/dates";
import { colorForItem } from "@/lib/boards/timeline-color";
import { updateBoardView } from "@/lib/boards/view-actions";
import { BoardHeader } from "@/components/boards/BoardHeader";
import type { BoardAccess, HeaderGrant } from "@/components/boards/BoardHeader";
import { Kicker } from "@/components/ui/kicker";
import type { EditorMember } from "@/components/boards/cells/editors";
import {
  ItemQuickEdit,
  type QuickEditTarget,
} from "@/components/boards/quick-edit/ItemQuickEdit";
import {
  DAY_W,
  LABEL_W,
  ROW_H,
  ZOOM_DAY_COUNT,
  buildMonthTicks,
  effectiveCriticalLabel,
  parseISO,
  todayISO,
  type BarDragData,
} from "@/components/boards/gantt/utils";
import { GanttRowItem } from "@/components/boards/gantt/GanttRowItem";
import { UnscheduledSection } from "@/components/boards/gantt/UnscheduledSection";

// ---------------------------------------------------------------------------
// GanttBoard (main export)
// ---------------------------------------------------------------------------

export function GanttBoard({
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
  const mutations = useBoardMutations(payload.board.id);

  const [, startTransition] = useTransition();

  // Resolve the selected view and its config
  const selectedView = payload.views.find((v) => v.id === selectedViewId);
  const config = (selectedView?.config ?? null) as {
    date_column_id?: string | null;
    end_column_id?: string | null;
    color_column_id?: string | null;
    zoom?: "week" | "month";
  } | null;

  const dateColumns = cache.columns.filter((c) => c.kind === "date");
  const colorColumns = cache.columns.filter(
    (c) => c.kind === "status" || c.kind === "dropdown",
  );

  // Smart defaults when the view has never set start/end explicitly.
  const seeded = defaultTimelineColumns(
    dateColumns.map((c) => ({ id: c.id, name: c.name })),
  );

  const [zoom, setZoom] = useState<"week" | "month">(config?.zoom ?? "month");
  const [startColId, setStartColId] = useState<string | null>(
    config?.date_column_id ?? seeded.startColumnId,
  );
  const [endColId, setEndColId] = useState<string | null>(
    config?.end_column_id ?? seeded.endColumnId,
  );
  const [colorColId, setColorColId] = useState<string | null>(
    config?.color_column_id ?? null,
  );

  const dateColumn =
    dateColumns.find((c) => c.id === startColId) ?? dateColumns[0] ?? null;
  const colorColumn = colorColumns.find((c) => c.id === colorColId) ?? null;

  // dnd-kit sensors — shared touch-aware setup (PointerSensor 6px + TouchSensor
  // long-press lift) so a finger can move bars on iPad while a quick swipe scrolls.
  const sensors = useTouchAwareSensors();

  // Earliest scheduled item start date for range anchoring.
  // Guard: returns "" when no dateColumn (we'll be in the early-return path).
  // Use startColId (stable state) rather than the derived dateColumn object as dep.
  const rangeStartISO = useMemo(() => {
    if (!dateColumn) return "";
    const colId = dateColumn.id;
    const sorted = cache.cellValues
      .filter(
        (cv) =>
          cv.column_id === colId &&
          typeof (cv.value as Record<string, unknown>)?.date === "string",
      )
      .map((cv) => (cv.value as { date: string }).date)
      .sort();
    if (sorted.length > 0) return sorted[0];
    const t = new Date();
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-01`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startColId, cache.cellValues]);

  // Latest date across the start and end columns — how far the last bar reaches.
  const rangeEndISO = useMemo(() => {
    let max = "";
    for (const cv of cache.cellValues) {
      if (cv.column_id !== startColId && cv.column_id !== endColId) continue;
      const d = (cv.value as { date?: string } | null)?.date;
      if (typeof d === "string" && d > max) max = d;
    }
    return max;
  }, [startColId, endColId, cache.cellValues]);

  // Grid width in days: the zoom window, extended to fit the full data range so
  // bars beyond the window aren't clipped off-screen.
  const dayCount = timelineDayCount(
    rangeStartISO,
    rangeEndISO,
    ZOOM_DAY_COUNT[zoom],
  );

  // Build Gantt row layout (positions all items on the timeline).
  const ganttResult = useMemo(() => {
    if (!dateColumn || !rangeStartISO) return null;
    return buildGanttRows(
      cache.items,
      cache.cellValues,
      dateColumn.id,
      endColId,
      rangeStartISO,
      dayCount,
      zoom,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    startColId,
    endColId,
    rangeStartISO,
    cache.items,
    cache.cellValues,
    dayCount,
    zoom,
  ]);

  const rows = useMemo(() => ganttResult?.rows ?? [], [ganttResult]);

  // Detect dependency violations (finish-to-start constraint check).
  const violations = useMemo(
    () => detectViolations(rows, cache.dependencies),
    [rows, cache.dependencies],
  );

  const scheduledRows = useMemo(() => rows.filter((r) => r.scheduled), [rows]);
  const unscheduledRows = useMemo(
    () => rows.filter((r) => !r.scheduled),
    [rows],
  );

  const rowColors = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const r of rows) {
      map.set(r.itemId, colorForItem(r.itemId, colorColumn, cache.cellValues));
    }
    return map;
    // colorColumn is derived from colorColId which is stable state; colorColumn object identity
    // is stable for the same id within a render. Dep array uses colorColId to avoid object ref issues.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, colorColId, cache.cellValues, cache.columns]);

  // First status/percent columns + cell map for the quick-edit peek (mirrors
  // CalendarBoard). All reads come from the in-memory board cache.
  const statusColumn = useMemo(
    () => cache.columns.find((c) => c.kind === "status"),
    [cache.columns],
  );
  const percentColumn = useMemo(
    () => cache.columns.find((c) => c.kind === "percent"),
    [cache.columns],
  );
  const cellMap = useMemo(
    () => buildCellMap(cache.cellValues),
    [cache.cellValues],
  );
  // Name-rail critical dot: direct-dependent counts (O(E), memoized) + the
  // board's first priority column feed effectivePriority per row. The dot also
  // renders on boards with no priority column for auto (>= 2 dependents) items
  // — the signal is about the dependency graph this view is drawing.
  const dependentsByItem = useMemo(
    () => buildDependentsCountMap(cache.dependencies ?? []),
    [cache.dependencies],
  );
  const priorityColumn = useMemo(
    () => cache.columns.find((c) => c.kind === "priority"),
    [cache.columns],
  );
  // The tapped bar/milestone/row the quick-edit peek is anchored to.
  const [quickEdit, setQuickEdit] = useState<QuickEditTarget | null>(null);

  // Month tick labels for the timeline header.
  const monthTicks = useMemo(
    () => (rangeStartISO ? buildMonthTicks(rangeStartISO, dayCount) : []),
    [rangeStartISO, dayCount],
  );

  const totalW = dayCount * DAY_W;

  // Row index lookup for SVG arrow geometry.
  const rowIndexMap = useMemo(
    () => new Map(scheduledRows.map((r, i) => [r.itemId, i])),
    [scheduledRows],
  );

  // Build dependency arrow geometry data.
  const arrowLines = useMemo(
    () =>
      cache.dependencies
        .map((dep) => {
          const predIdx = rowIndexMap.get(dep.predecessor_id);
          const succIdx = rowIndexMap.get(dep.successor_id);
          const predRow = scheduledRows[predIdx ?? -1];
          const succRow = scheduledRows[succIdx ?? -1];
          if (
            predIdx === undefined ||
            succIdx === undefined ||
            (!predRow?.startCol !== undefined &&
              predRow.spanCols !== undefined &&
              succRow.startCol !== undefined)
          ) {
            return null;
          }
          if (predRow?.startCol === undefined || predRow.spanCols === undefined)
            return null;
          if (succRow?.startCol === undefined) return null;
          return { dep, predIdx, succIdx, predRow, succRow };
        })
        .filter(Boolean) as {
        dep: CacheDependency;
        predIdx: number;
        succIdx: number;
        predRow: GanttRow;
        succRow: GanttRow;
      }[],
    [cache.dependencies, rowIndexMap, scheduledRows],
  );

  const today = todayISO();
  const todayOffset = rangeStartISO
    ? Math.round((parseISO(today) - parseISO(rangeStartISO)) / 86_400_000)
    : -1;

  // Empty state: no date column
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
          <div className="flex flex-col items-center gap-3 text-center">
            <GanttChartSquare
              className="text-muted-foreground size-10"
              aria-hidden
            />
            <p className="text-muted-foreground text-sm">
              Add a Date column to use the Timeline view.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const resolvedDateColumn = dateColumn;

  /**
   * Open the item detail panel by setting `?item=<id>` via the History API —
   * no RSC navigation, so the board page's queries don't re-run (gotcha-09).
   * {@link BoardViews} reads the param and renders the panel on any view.
   */
  function openItemPanel(itemId: string) {
    const url = new URL(window.location.href);
    url.searchParams.set("item", itemId);
    window.history.pushState({}, "", url);
  }

  /**
   * Tap on a bar / milestone / unscheduled row: open the quick-edit peek when
   * the board has a status or percent column to edit; otherwise fall back to
   * the ItemPanel so the peek never renders empty.
   */
  function handleItemTap(itemId: string, anchorRect: DOMRect) {
    if (statusColumn || percentColumn) setQuickEdit({ itemId, anchorRect });
    else openItemPanel(itemId);
  }

  function persistConfig(next: {
    date_column_id?: string | null;
    end_column_id?: string | null;
    color_column_id?: string | null;
    zoom?: "week" | "month";
  }) {
    const merged = {
      date_column_id: startColId,
      end_column_id: endColId,
      color_column_id: colorColId,
      zoom,
      ...next,
    };
    // In-page change over already-loaded data: update local state instantly
    // (0 server round-trips) and persist config in the background. No
    // router.refresh() — see gotcha-09. The persist can still fail (RLS, network),
    // so surface it instead of letting it look saved until the next reload.
    startTransition(async () => {
      const res = await updateBoardView({
        viewId: selectedViewId,
        config: merged,
      });
      if (!res.ok) {
        toast.error("Couldn't save the view settings.", {
          description: res.error,
        });
      }
    });
  }

  function handleZoomChange(newZoom: "week" | "month") {
    setZoom(newZoom);
    persistConfig({ zoom: newZoom });
  }
  function handleStartColumnChange(columnId: string) {
    setStartColId(columnId);
    persistConfig({ date_column_id: columnId });
  }
  function handleEndColumnChange(columnId: string) {
    const next = columnId === "" ? null : columnId;
    setEndColId(next);
    persistConfig({ end_column_id: next });
  }
  function handleColorColumnChange(columnId: string) {
    const next = columnId === "" ? null : columnId;
    setColorColId(next);
    persistConfig({ color_column_id: next });
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, delta } = event;
    const data = active.data.current as BarDragData | undefined;
    if (!data || data.kind !== "bar") return;
    const deltaDays = Math.round(delta.x / DAY_W);
    if (deltaDays === 0) return;
    const range = itemDateRange(
      data.itemId,
      cache.cellValues,
      data.startColumnId,
    );
    if (!range) return;
    onBarMoved(
      data.itemId,
      deltaDays,
      range,
      data.startColumnId,
      data.endColumnId,
      mutations.setCell as Parameters<typeof onBarMoved>[5],
    );
  }

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

      {/* Controls bar */}
      <div className="flex items-center gap-3 border-b px-6 py-2">
        {/* Zoom toggle */}
        <div className="flex items-center gap-1 rounded-md border p-0.5">
          {(["week", "month"] as const).map((z) => (
            <button
              key={z}
              type="button"
              onClick={() => handleZoomChange(z)}
              className={cn(
                "rounded px-2.5 py-1 text-xs font-medium capitalize transition-colors pointer-coarse:min-h-11 pointer-coarse:px-3",
                zoom === z
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent",
              )}
            >
              {z}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-3">
          <label
            htmlFor="gantt-start-column"
            className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium"
          >
            <CalendarDays className="size-3.5" aria-hidden />
            Start
          </label>
          <select
            id="gantt-start-column"
            aria-label="Start date column"
            value={dateColumn?.id ?? ""}
            onChange={(e) => handleStartColumnChange(e.target.value)}
            className="bg-surface focus-visible:ring-ring rounded-md border px-2 py-1 text-sm focus-visible:ring-2 focus-visible:outline-none pointer-coarse:min-h-11 pointer-coarse:px-3"
          >
            {dateColumns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          <label
            htmlFor="gantt-end-column"
            className="text-muted-foreground text-xs font-medium"
          >
            End
          </label>
          <select
            id="gantt-end-column"
            aria-label="End date column"
            value={endColId ?? ""}
            onChange={(e) => handleEndColumnChange(e.target.value)}
            className="bg-surface focus-visible:ring-ring rounded-md border px-2 py-1 text-sm focus-visible:ring-2 focus-visible:outline-none pointer-coarse:min-h-11 pointer-coarse:px-3"
          >
            <option value="">None</option>
            {dateColumns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          <label
            htmlFor="gantt-color-column"
            className="text-muted-foreground text-xs font-medium"
          >
            Color by
          </label>
          <select
            id="gantt-color-column"
            aria-label="Color by column"
            value={colorColId ?? ""}
            onChange={(e) => handleColorColumnChange(e.target.value)}
            className="bg-surface focus-visible:ring-ring rounded-md border px-2 py-1 text-sm focus-visible:ring-2 focus-visible:outline-none pointer-coarse:min-h-11 pointer-coarse:px-3"
          >
            <option value="">None</option>
            {colorColumns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Gantt grid */}
      <DndContext
        id={`gantt-${selectedViewId}`}
        sensors={sensors}
        onDragEnd={handleDragEnd}
      >
        <div className="min-h-0 flex-1 overflow-auto">
          <div className="inline-block min-w-full">
            {/* Sticky header row */}
            <div className="bg-background sticky top-0 z-20 flex border-b">
              {/* Name rail header */}
              <div
                className="bg-background hover:border-border-hover sticky left-0 z-10 flex shrink-0 items-center border-r px-4 py-2.5"
                style={{ width: LABEL_W }}
              >
                <Kicker>Item</Kicker>
              </div>
              {/* Timeline header */}
              <div className="relative" style={{ width: totalW, height: 38 }}>
                {/* Month tick labels */}
                {monthTicks.map((tick) => (
                  <div
                    key={tick.dayOffset}
                    className="text-muted-foreground absolute top-0 h-full border-l pt-2 pl-1.5 text-[11px]"
                    style={{ left: tick.dayOffset * DAY_W }}
                  >
                    {tick.label}
                  </div>
                ))}
                {/* Today line */}
                {todayOffset >= 0 && todayOffset <= dayCount && (
                  <div
                    className="bg-destructive/70 absolute top-0 z-10 h-full w-px"
                    style={{ left: todayOffset * DAY_W }}
                    aria-label="Today"
                  />
                )}
              </div>
            </div>

            {/* Scheduled rows with SVG arrow overlay */}
            <div className="relative">
              {scheduledRows.map((row, rowIdx) => (
                <GanttRowItem
                  key={row.itemId}
                  row={row}
                  criticalLabel={effectiveCriticalLabel(
                    priorityColumn
                      ? (cellMap.get(cellKey(row.itemId, priorityColumn.id)) ??
                          null)
                      : null,
                    dependentsByItem.get(row.itemId) ?? 0,
                  )}
                  rowIdx={rowIdx}
                  totalW={totalW}
                  todayOffset={todayOffset}
                  dayCount={dayCount}
                  startColumnId={resolvedDateColumn.id}
                  endColumnId={endColId}
                  color={rowColors.get(row.itemId) ?? null}
                  allRows={scheduledRows}
                  dependencies={cache.dependencies}
                  violations={violations}
                  onBarResized={(itemId, newEndISO, range) =>
                    onBarResized(
                      itemId,
                      newEndISO,
                      range,
                      resolvedDateColumn.id,
                      endColId,
                      mutations.setCell as Parameters<typeof onBarResized>[5],
                    )
                  }
                  addDependency={mutations.addDependency}
                  removeDependency={mutations.removeDependency}
                  onItemTap={handleItemTap}
                />
              ))}

              {/* SVG dependency arrow overlay */}
              {arrowLines.length > 0 && (
                <svg
                  className="pointer-events-none absolute inset-0"
                  style={{
                    width: LABEL_W + totalW,
                    height: scheduledRows.length * ROW_H,
                  }}
                  aria-hidden
                >
                  {arrowLines.map(
                    ({ dep, predIdx, succIdx, predRow, succRow }) => {
                      const isViolation = violations.has(dep.id);
                      const predEndX =
                        LABEL_W +
                        ((predRow.startCol ?? 0) + (predRow.spanCols ?? 1)) *
                          DAY_W;
                      const predMidY = predIdx * ROW_H + ROW_H / 2;
                      const succStartX =
                        LABEL_W + (succRow.startCol ?? 0) * DAY_W;
                      const succMidY = succIdx * ROW_H + ROW_H / 2;
                      const mx = (predEndX + succStartX) / 2;
                      const d = `M${predEndX},${predMidY} C${mx},${predMidY} ${mx},${succMidY} ${succStartX},${succMidY}`;
                      return (
                        <path
                          key={dep.id}
                          d={d}
                          fill="none"
                          strokeWidth={1.5}
                          className={
                            isViolation
                              ? "stroke-destructive"
                              : "stroke-muted-foreground"
                          }
                          markerEnd="url(#arrowhead)"
                          opacity={0.7}
                        />
                      );
                    },
                  )}
                  <defs>
                    <marker
                      id="arrowhead"
                      markerWidth="6"
                      markerHeight="6"
                      refX="3"
                      refY="3"
                      orient="auto"
                    >
                      <path
                        d="M0,0 L0,6 L6,3 z"
                        className="fill-muted-foreground"
                      />
                    </marker>
                  </defs>
                </svg>
              )}
            </div>
          </div>
        </div>
      </DndContext>

      {/* Unscheduled section */}
      <UnscheduledSection rows={unscheduledRows} onItemTap={handleItemTap} />

      {quickEdit && (
        <ItemQuickEdit
          target={quickEdit}
          itemName={
            cache.items.find((i) => i.id === quickEdit.itemId)?.name ?? ""
          }
          statusColumn={statusColumn ?? null}
          percentColumn={percentColumn ?? null}
          statusValue={
            statusColumn
              ? ((cellMap.get(cellKey(quickEdit.itemId, statusColumn.id)) ??
                  null) as { optionId: string | null } | null)
              : null
          }
          percentValue={
            percentColumn
              ? ((cellMap.get(cellKey(quickEdit.itemId, percentColumn.id)) ??
                  null) as { percent: number } | null)
              : null
          }
          setCell={mutations.setCell}
          clearCellValue={mutations.clearCellValue}
          onOpenItem={openItemPanel}
          onClose={() => setQuickEdit(null)}
        />
      )}
    </div>
  );
}
