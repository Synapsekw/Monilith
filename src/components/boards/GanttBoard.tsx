"use client";

import { useState, useTransition, useRef, useMemo } from "react";
import {
  DndContext,
  useDraggable,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  CalendarDays,
  ChevronRight,
  GanttChartSquare,
  MoreHorizontal,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { BoardPayload } from "@/lib/boards/queries";
import type { BoardCache, CacheDependency } from "@/lib/boards/cache";
import { useBoardCache } from "@/lib/boards/use-board-cache";
import { useBoardMutations } from "@/lib/boards/use-board-mutations";
import {
  buildGanttRows,
  detectViolations,
  onBarMoved,
  onBarResized,
  type GanttRow,
} from "@/lib/boards/gantt";
import { itemDateRange, defaultTimelineColumns } from "@/lib/boards/dates";
import { colorForItem } from "@/lib/boards/timeline-color";
import { pillTextColor } from "@/lib/boards/contrast";
import { updateBoardView } from "@/lib/boards/view-actions";
import { presenceTarget } from "@/lib/boards/presence-target";
import { usePresenceFocus } from "@/lib/boards/use-presence-focus";
import { BoardHeader } from "@/components/boards/BoardHeader";
import type { BoardAccess, HeaderGrant } from "@/components/boards/BoardHeader";
import { PresenceRing } from "@/components/boards/presence/PresenceRing";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { EditorMember } from "@/components/boards/cells/editors";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DAY_W = 28; // px per day column
const LABEL_W = 200; // px for the left name rail
const ROW_H = 40; // px per row
const BAR_H = 24; // px bar height
const MILESTONE = 13; // px milestone diamond (pre-rotation); centered in its day column

// Week → ~28 days, Month → ~90 days
const ZOOM_DAY_COUNT: Record<"week" | "month", number> = {
  week: 28,
  month: 90,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse YYYY-MM-DD → UTC ms */
function parseISO(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Format UTC ms → YYYY-MM-DD */
function formatISO(ms: number): string {
  const d = new Date(ms);
  return [
    d.getUTCFullYear(),
    String(d.getUTCMonth() + 1).padStart(2, "0"),
    String(d.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

/** Generate month tick labels for the header */
function buildMonthTicks(
  rangeStartISO: string,
  dayCount: number,
): { label: string; dayOffset: number }[] {
  const ticks: { label: string; dayOffset: number }[] = [];
  const startMs = parseISO(rangeStartISO);
  const endMs = startMs + dayCount * 86_400_000;

  // Find first day of month on/after range start
  const start = new Date(startMs);
  let cur = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  if (cur.getTime() < startMs) {
    cur = new Date(
      Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1),
    );
  }

  while (cur.getTime() < endMs) {
    const dayOffset = Math.round((cur.getTime() - startMs) / 86_400_000);
    const label = cur.toLocaleDateString("en-US", {
      month: "short",
      year: "2-digit",
      timeZone: "UTC",
    });
    ticks.push({ label, dayOffset });
    cur = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1));
  }

  return ticks;
}

/** Today as YYYY-MM-DD */
function todayISO(): string {
  const d = new Date();
  return formatISO(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

// ---------------------------------------------------------------------------
// Drag data shapes
// ---------------------------------------------------------------------------

type BarDragData = {
  kind: "bar";
  itemId: string;
  startISO: string;
  endISO: string;
  startColumnId: string;
  endColumnId: string | null;
  startDayOffset: number;
};

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

  // dnd-kit sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const dayCount = ZOOM_DAY_COUNT[zoom];

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
    // router.refresh() — see gotcha-09.
    startTransition(() => {
      void updateBoardView({ viewId: selectedViewId, config: merged });
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
                "rounded px-2.5 py-1 text-xs font-medium capitalize transition-colors",
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
            className="bg-surface focus-visible:ring-ring rounded-md border px-2 py-1 text-sm focus-visible:ring-2 focus-visible:outline-none"
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
            className="bg-surface focus-visible:ring-ring rounded-md border px-2 py-1 text-sm focus-visible:ring-2 focus-visible:outline-none"
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
            className="bg-surface focus-visible:ring-ring rounded-md border px-2 py-1 text-sm focus-visible:ring-2 focus-visible:outline-none"
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
                className="text-muted-foreground bg-background sticky left-0 z-10 shrink-0 border-r px-4 py-2.5 text-[11px] font-semibold tracking-wide uppercase"
                style={{ width: LABEL_W }}
              >
                Item
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
      <UnscheduledSection rows={unscheduledRows} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// GanttRowItem
// ---------------------------------------------------------------------------

function GanttRowItem({
  row,
  rowIdx,
  totalW,
  todayOffset,
  dayCount,
  startColumnId,
  endColumnId,
  color,
  allRows,
  dependencies,
  violations,
  onBarResized: handleBarResized,
  addDependency,
  removeDependency,
}: {
  row: GanttRow;
  rowIdx: number;
  totalW: number;
  todayOffset: number;
  dayCount: number;
  startColumnId: string;
  endColumnId: string | null;
  color: string | null;
  allRows: GanttRow[];
  dependencies: CacheDependency[];
  violations: Set<string>;
  onBarResized: (
    itemId: string,
    newEndISO: string,
    range: { start: string; end: string },
  ) => void;
  addDependency: (
    vars: { predecessorId: string; successorId: string },
    callbacks?: { onError?: (err: Error) => void },
  ) => void;
  removeDependency: (vars: { dependencyId: string }) => void;
}) {
  void rowIdx;
  void allRows;
  void violations;

  const dragData: BarDragData = {
    kind: "bar",
    itemId: row.itemId,
    startISO: row.startISO ?? "",
    endISO: row.endISO ?? "",
    startColumnId,
    endColumnId,
    startDayOffset: row.startCol ?? 0,
  };

  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: `gantt-bar-${row.itemId}`,
      data: dragData,
    });

  // In-view presence signal: someone is dragging this bar/milestone. Broadcast
  // focus while dragged; the ring surfaces other users' drags on the same event.
  const target = presenceTarget.event(row.itemId);
  usePresenceFocus({ viewKind: "timeline", targetId: target }, isDragging);

  const barStyle = transform
    ? { transform: `translate3d(${transform.x}px, 0, 0)` }
    : undefined;

  const barLeft = (row.startCol ?? 0) * DAY_W;
  const barWidth = row.isMilestone
    ? BAR_H // diamond
    : Math.max(DAY_W, (row.spanCols ?? 1) * DAY_W);

  // Predecessors of this item (items that must finish before this starts)
  const predecessorDeps = useMemo(
    () => dependencies.filter((d) => d.successor_id === row.itemId),
    [dependencies, row.itemId],
  );
  const otherItems = useMemo(
    () => allRows.filter((r) => r.itemId !== row.itemId),
    [allRows, row.itemId],
  );

  // Resize state
  const resizeStartXRef = useRef<number | null>(null);
  const resizeStartEndRef = useRef<string | null>(null);

  function handleResizeStart(e: React.PointerEvent) {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    resizeStartXRef.current = e.clientX;
    resizeStartEndRef.current = row.endISO ?? row.startISO ?? null;
  }

  function handleResizeMove(e: React.PointerEvent) {
    if (resizeStartXRef.current === null || !resizeStartEndRef.current) return;
    const deltaDays = Math.round((e.clientX - resizeStartXRef.current) / DAY_W);
    if (deltaDays === 0) return;
    // Compute new end from original end + delta
    const origEndMs = parseISO(resizeStartEndRef.current);
    const newEndISO = formatISO(origEndMs + deltaDays * 86_400_000);
    const range = { start: row.startISO ?? "", end: row.endISO ?? "" };
    if (newEndISO >= range.start) {
      handleBarResized(row.itemId, newEndISO, range);
    }
  }

  function handleResizeEnd() {
    resizeStartXRef.current = null;
    resizeStartEndRef.current = null;
  }

  return (
    <div
      className="group hover:bg-accent/5 flex border-b"
      style={{ height: ROW_H }}
    >
      {/* Sticky name label */}
      <div
        className="bg-background sticky left-0 z-10 flex shrink-0 items-center border-r px-4"
        style={{ width: LABEL_W }}
      >
        <span className="text-foreground min-w-0 flex-1 truncate text-[12.5px]">
          {row.name}
        </span>
        {/* ⋯ menu for dependency management */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={`Options for ${row.name}`}
              className="text-muted-foreground hover:text-foreground size-6 opacity-0 group-hover:opacity-100"
            >
              <MoreHorizontal className="size-3.5" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            {otherItems.length > 0 && (
              <>
                <div className="text-muted-foreground px-2 py-1 text-[11px] font-semibold tracking-wide uppercase">
                  Blocked by…
                </div>
                {otherItems.map((other) => (
                  <DropdownMenuItem
                    key={other.itemId}
                    onSelect={() =>
                      addDependency(
                        {
                          predecessorId: other.itemId,
                          successorId: row.itemId,
                        },
                        {
                          onError: (err) => console.error(err),
                        },
                      )
                    }
                  >
                    {other.name}
                  </DropdownMenuItem>
                ))}
                {predecessorDeps.length > 0 && <DropdownMenuSeparator />}
              </>
            )}
            {predecessorDeps.map((dep) => (
              <DropdownMenuItem
                key={dep.id}
                variant="destructive"
                onSelect={() => removeDependency({ dependencyId: dep.id })}
              >
                Remove dep #{dep.id.slice(0, 6)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Timeline track */}
      <div
        className="relative overflow-hidden"
        style={{ width: totalW, height: ROW_H }}
      >
        {/* Today hairline */}
        {todayOffset >= 0 && todayOffset <= dayCount && (
          <div
            className="bg-destructive/30 absolute top-0 h-full w-px"
            style={{ left: todayOffset * DAY_W }}
            aria-hidden
          />
        )}

        {/* Bar or milestone diamond */}
        {row.isMilestone ? (
          <div
            ref={setNodeRef}
            className={cn(
              "absolute rotate-45 cursor-grab rounded-sm",
              color ? "" : "bg-primary",
              isDragging && "opacity-50",
            )}
            style={{
              left: barLeft + DAY_W / 2 - MILESTONE / 2,
              top: ROW_H / 2 - MILESTONE / 2,
              width: MILESTONE,
              height: MILESTONE,
              ...(color ? { backgroundColor: color } : {}),
              ...barStyle,
            }}
            {...listeners}
            {...attributes}
            title={row.name}
          >
            <PresenceRing target={target} className="rounded-sm" />
          </div>
        ) : (
          <div
            ref={setNodeRef}
            className={cn(
              "absolute flex cursor-grab items-center rounded-md shadow-sm",
              color ? "" : "bg-primary",
              isDragging && "opacity-50",
            )}
            style={{
              left: barLeft,
              top: ROW_H / 2 - BAR_H / 2,
              width: barWidth,
              height: BAR_H,
              ...(color ? { backgroundColor: color } : {}),
              ...barStyle,
            }}
          >
            <PresenceRing target={target} />
            {/* Drag handle covering most of the bar */}
            <div
              {...listeners}
              {...attributes}
              className="flex h-full flex-1 items-center overflow-hidden px-2"
            >
              <span
                className={cn(
                  "truncate text-[11px] font-medium",
                  color ? "" : "text-primary-foreground",
                )}
                style={color ? { color: pillTextColor(color) } : undefined}
              >
                {row.name}
              </span>
            </div>
            {/* Right-edge resize handle */}
            <div
              onPointerDown={handleResizeStart}
              onPointerMove={handleResizeMove}
              onPointerUp={handleResizeEnd}
              onPointerLeave={handleResizeEnd}
              className="hover:bg-primary-foreground/20 h-full w-2 cursor-ew-resize rounded-r-md"
              aria-label={`Resize ${row.name}`}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// UnscheduledSection
// ---------------------------------------------------------------------------

function UnscheduledSection({ rows }: { rows: GanttRow[] }) {
  const [open, setOpen] = useState(false);

  if (rows.length === 0) return null;

  return (
    <div className="border-t">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="text-muted-foreground hover:bg-accent flex w-full items-center gap-2 px-6 py-2 text-sm font-medium transition-colors"
      >
        <span>Unscheduled ({rows.length})</span>
        <ChevronRight
          aria-hidden
          className={cn("size-3.5 transition-transform", open && "rotate-90")}
        />
      </button>
      <ul hidden={!open} aria-hidden={!open} className="border-t px-6 py-2">
        {rows.map((row) => (
          <li
            key={row.itemId}
            className="text-foreground truncate py-0.5 text-sm"
          >
            {row.name}
          </li>
        ))}
      </ul>
    </div>
  );
}
