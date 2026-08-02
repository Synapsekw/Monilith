"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useTransition,
  useMemo,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
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
  visibleRows,
  type GanttRow,
} from "@/lib/boards/gantt";
import {
  itemDateRange,
  defaultTimelineColumns,
  isSyntheticDateSource,
  syntheticDateCellValues,
  CREATED_AT_SOURCE,
  UPDATED_AT_SOURCE,
} from "@/lib/boards/dates";
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
  LABEL_W,
  ROW_H,
  PX_PER_DAY,
  ZOOM_DAY_COUNT,
  fittedDayW,
  buildMonthTicks,
  buildQuarterTicks,
  effectiveCriticalLabel,
  parseISO,
  todayISO,
  type BarDragData,
  type TimelineZoom,
} from "@/components/boards/gantt/utils";
import { GanttRowItem } from "@/components/boards/gantt/GanttRowItem";
import { UnscheduledSection } from "@/components/boards/gantt/UnscheduledSection";

// ---------------------------------------------------------------------------
// GanttBoard (main export)
// ---------------------------------------------------------------------------

// useLayoutEffect warns during SSR; this client component still pre-renders on
// the server, so fall back to useEffect there (same guard as GroupSection).
const useIsoLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

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
    zoom?: TimelineZoom;
  } | null;

  const dateColumns = cache.columns.filter((c) => c.kind === "date");
  const colorColumns = cache.columns.filter(
    (c) => c.kind === "status" || c.kind === "dropdown",
  );

  // Smart defaults when the view has never set start/end explicitly.
  const seeded = defaultTimelineColumns(
    dateColumns.map((c) => ({ id: c.id, name: c.name })),
  );

  const [zoom, setZoom] = useState<TimelineZoom>(config?.zoom ?? "month");
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

  // Start/End picker options: real date columns plus the item's own timestamps
  // (Created at / Updated at) as synthetic, read-only sources.
  const dateSourceOptions = useMemo(
    () => [
      ...dateColumns.map((c) => ({ id: c.id, name: c.name })),
      { id: CREATED_AT_SOURCE, name: "Created at" },
      { id: UPDATED_AT_SOURCE, name: "Updated at" },
    ],
    [dateColumns],
  );

  // The ids actually used to resolve dates. A synthetic pick keeps its sentinel;
  // a real/absent start falls back to the resolved date column.
  const startSourceId = isSyntheticDateSource(startColId)
    ? startColId
    : (dateColumn?.id ?? null);
  const endSourceId = endColId;
  // A timestamp-sourced bar can't be dragged/resized — there's no cell to write.
  const readOnly =
    isSyntheticDateSource(startSourceId) || isSyntheticDateSource(endSourceId);

  // Cell values augmented with synthetic created/updated-at cells when a
  // timestamp source is selected, so date resolution reads them like any cell.
  const effectiveCellValues = useMemo(() => {
    const needed = [startSourceId, endSourceId].filter((id): id is string =>
      isSyntheticDateSource(id),
    );
    if (needed.length === 0) return cache.cellValues;
    return [
      ...cache.cellValues,
      ...syntheticDateCellValues(cache.items, needed),
    ];
  }, [cache.cellValues, cache.items, startSourceId, endSourceId]);

  // dnd-kit sensors — shared touch-aware setup (PointerSensor 6px + TouchSensor
  // long-press lift) so a finger can move bars on iPad while a quick swipe scrolls.
  const sensors = useTouchAwareSensors();

  // Earliest scheduled item start date for range anchoring.
  // Guard: returns "" when no dateColumn (we'll be in the early-return path).
  const rangeStartISO = useMemo(() => {
    if (!dateColumn || !startSourceId) return "";
    const sorted = effectiveCellValues
      .filter(
        (cv) =>
          cv.column_id === startSourceId &&
          typeof (cv.value as Record<string, unknown>)?.date === "string",
      )
      .map((cv) => (cv.value as { date: string }).date)
      .sort();
    if (sorted.length > 0) return sorted[0];
    const t = new Date();
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-01`;
  }, [startSourceId, effectiveCellValues, dateColumn]);

  // Latest date across the start and end sources — how far the last bar reaches.
  const rangeEndISO = useMemo(() => {
    let max = "";
    for (const cv of effectiveCellValues) {
      if (cv.column_id !== startSourceId && cv.column_id !== endSourceId)
        continue;
      const d = (cv.value as { date?: string } | null)?.date;
      if (typeof d === "string" && d > max) max = d;
    }
    return max;
  }, [startSourceId, endSourceId, effectiveCellValues]);

  // Grid width in days: the zoom window, extended to fit the full data range so
  // bars beyond the window aren't clipped off-screen.
  const dayCount = timelineDayCount(
    rangeStartISO,
    rangeEndISO,
    ZOOM_DAY_COUNT[zoom],
  );

  // Build Gantt row layout (positions all items on the timeline).
  const ganttResult = useMemo(() => {
    if (!dateColumn || !rangeStartISO || !startSourceId) return null;
    return buildGanttRows(
      cache.items,
      effectiveCellValues,
      startSourceId,
      endSourceId,
      rangeStartISO,
      dayCount,
      zoom,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    startSourceId,
    endSourceId,
    rangeStartISO,
    cache.items,
    effectiveCellValues,
    dayCount,
    zoom,
  ]);

  const rows = useMemo(() => ganttResult?.rows ?? [], [ganttResult]);

  // Detect dependency violations (finish-to-start constraint check).
  const violations = useMemo(
    () => detectViolations(rows, cache.dependencies),
    [rows, cache.dependencies],
  );

  // Rows with an actual bar (a valid date range) — the dependency picker offers
  // these as endpoints.
  const scheduledRows = useMemo(() => rows.filter((r) => r.scheduled), [rows]);
  // Rows that belong on the timeline: scheduled items PLUS parent "header" rows
  // that have at least one scheduled sub-item — even when the parent itself has
  // no dates. This keeps a scheduled sub-item reachable (it always nests under a
  // present, collapsible parent) instead of being stranded when its parent is
  // unscheduled. A parent with a scheduled child always has hasChildren set, so
  // no scheduled child is ever orphaned.
  const timelineRows = useMemo(
    () => rows.filter((r) => r.scheduled || r.hasChildren),
    [rows],
  );
  // Truly unscheduled leaves (no bar and no scheduled children) drop to the
  // Unscheduled section; parent headers stay on the timeline.
  const unscheduledRows = useMemo(
    () => rows.filter((r) => !r.scheduled && !r.hasChildren),
    [rows],
  );

  // Sub-item nesting: parents collapsed by default so the timeline opens as a
  // compact top-level overview; expand a parent to reveal its scheduled
  // sub-items. Local state (not persisted), mirroring the Table view.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const toggleExpand = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  // The rows actually drawn on the timeline: every top-level row (incl. parent
  // headers), plus the sub-items of expanded parents. Virtualization, the
  // rows-area height, and dependency-arrow indexing all key off this list.
  const visibleTimelineRows = useMemo(
    () => visibleRows(timelineRows, expanded),
    [timelineRows, expanded],
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

  // Header tick labels. Year zoom uses coarser quarter ticks (monthly ticks
  // would cram together at ~1.5px/day); every other level keeps month ticks.
  const headerTicks = useMemo(() => {
    if (!rangeStartISO) return [];
    return zoom === "year"
      ? buildQuarterTicks(rangeStartISO, dayCount)
      : buildMonthTicks(rangeStartISO, dayCount);
  }, [rangeStartISO, dayCount, zoom]);

  // Pixels per day at the active zoom. Row day-offsets are scale-independent;
  // this multiplier is the only thing that turns them into on-screen width. The
  // zoom scale is a floor: when the date range is shorter than the visible
  // track, px/day stretches to fill the width (no dead space to the right);
  // when it overflows, the base scale wins and the grid scrolls. trackWidth is
  // the measured width available to the timeline (scroller minus the name rail).
  const [trackWidth, setTrackWidth] = useState(0);
  const dayW = fittedDayW(PX_PER_DAY[zoom], trackWidth, dayCount);
  const totalW = dayCount * dayW;

  // Row index lookup for SVG arrow geometry (over the visible, collapse-aware
  // row list — arrows to a hidden sub-item simply don't draw until expanded).
  const rowIndexMap = useMemo(
    () => new Map(visibleTimelineRows.map((r, i) => [r.itemId, i])),
    [visibleTimelineRows],
  );

  // ── Row virtualization (B3) ────────────────────────────────────────────────
  // The timeline can hold hundreds of scheduled rows; mounting every GanttRowItem
  // (each with a draggable bar, a dependency menu, presence wiring) is a slow
  // first paint and janky scroll. Window the rows with react-virtual keyed to the
  // vertical scroll container, mirroring the Table view's config. Row geometry is
  // unchanged (ROW_H per row); only the mounted node count drops.
  const scrollRef = useRef<HTMLDivElement>(null);
  const rowsAreaRef = useRef<HTMLDivElement>(null);
  // Offset of the rows area within the scroll content (the sticky header sits
  // above it) — the virtualizer needs it to map scroll position → row index.
  const [rowScrollMargin, setRowScrollMargin] = useState(0);
  useIsoLayoutEffect(() => {
    const area = rowsAreaRef.current;
    const scroller = scrollRef.current;
    if (!area || !scroller) return;
    const top =
      area.getBoundingClientRect().top -
      scroller.getBoundingClientRect().top +
      scroller.scrollTop;
    setRowScrollMargin((prev) => (prev === top ? prev : top));
    // Track width available to the timeline (scroller minus the sticky name
    // rail) — drives the fill-to-width day scale (see fittedDayW / dayW).
    const width = scroller.clientWidth - LABEL_W;
    setTrackWidth((prev) => (prev === width ? prev : width));
  });

  // Re-fit the day scale when the viewport resizes (sidebar toggle, window
  // resize) — the layout effect above only reruns on React renders, so observe
  // the scroller directly to keep the grid filling the available width.
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const width = scroller.clientWidth - LABEL_W;
      setTrackWidth((prev) => (prev === width ? prev : width));
    });
    ro.observe(scroller);
    return () => ro.disconnect();
  }, []);
  // React Compiler safely skips memoizing this component because useVirtualizer
  // returns non-memoizable functions; that fallback is correct here.
  // eslint-disable-next-line react-hooks/incompatible-library
  const rowVirtualizer = useVirtualizer({
    count: visibleTimelineRows.length,
    getScrollElement: () => scrollRef.current,
    scrollMargin: rowScrollMargin,
    estimateSize: () => ROW_H,
    overscan: 6,
    // getBoundingClientRect().height returns 0 in jsdom — fall back to ROW_H so
    // tests don't collapse every virtual row to 0px.
    measureElement: (el) => el.getBoundingClientRect().height || ROW_H,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();

  // Build dependency arrow geometry data.
  const arrowLines = useMemo(
    () =>
      cache.dependencies
        .map((dep) => {
          const predIdx = rowIndexMap.get(dep.predecessor_id);
          const succIdx = rowIndexMap.get(dep.successor_id);
          const predRow = visibleTimelineRows[predIdx ?? -1];
          const succRow = visibleTimelineRows[succIdx ?? -1];
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
    [cache.dependencies, rowIndexMap, visibleTimelineRows],
  );

  // B3b — clamp the arrow overlay to arrows with an endpoint inside the rendered
  // window (virtualRows already includes the overscan band). Endpoint→coordinate
  // math still uses the absolute whole-set index (predIdx * ROW_H), so positions
  // stay correct regardless of what's mounted; this just skips drawing arrows
  // that are entirely off-window.
  const visibleFirst = virtualRows[0]?.index ?? 0;
  const visibleLast =
    virtualRows[virtualRows.length - 1]?.index ??
    visibleTimelineRows.length - 1;
  const clampedArrows = arrowLines.filter(
    ({ predIdx, succIdx }) =>
      (predIdx >= visibleFirst && predIdx <= visibleLast) ||
      (succIdx >= visibleFirst && succIdx <= visibleLast),
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
    zoom?: TimelineZoom;
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

  function handleZoomChange(newZoom: TimelineZoom) {
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
    if (readOnly) return; // timestamp-sourced bars can't be moved
    const { active, delta } = event;
    const data = active.data.current as BarDragData | undefined;
    if (!data || data.kind !== "bar") return;
    const deltaDays = Math.round(delta.x / dayW);
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
          {(["week", "month", "quarter", "year"] as const).map((z) => (
            <button
              key={z}
              type="button"
              onClick={() => handleZoomChange(z)}
              className={cn(
                "rounded px-2.5 py-1 text-xs font-medium capitalize transition-colors pointer-coarse:min-h-11 pointer-coarse:px-3",
                zoom === z
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-state-hover",
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
            value={startColId ?? dateColumn?.id ?? ""}
            onChange={(e) => handleStartColumnChange(e.target.value)}
            className="bg-surface focus-visible:ring-ring rounded-md border px-2 py-1 text-sm focus-visible:ring-2 focus-visible:outline-none pointer-coarse:min-h-11 pointer-coarse:px-3"
          >
            {dateSourceOptions.map((c) => (
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
            {dateSourceOptions.map((c) => (
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
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
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
                {/* Header tick labels (month, or quarter at Year zoom) */}
                {headerTicks.map((tick) => (
                  <div
                    key={tick.dayOffset}
                    className="text-muted-foreground absolute top-0 h-full border-l pt-2 pl-1.5 text-[11px] whitespace-nowrap"
                    style={{ left: tick.dayOffset * dayW }}
                  >
                    {tick.label}
                  </div>
                ))}
                {/* Today line */}
                {todayOffset >= 0 && todayOffset <= dayCount && (
                  <div
                    className="bg-destructive/70 absolute top-0 z-10 h-full w-px"
                    style={{ left: todayOffset * dayW }}
                    aria-label="Today"
                  />
                )}
              </div>
            </div>

            {/* Scheduled rows (windowed) with SVG arrow overlay. The spacer div
                holds the full timeline height so scroll geometry is unchanged;
                each row is absolutely positioned at its virtual offset. */}
            <div
              ref={rowsAreaRef}
              className="relative"
              style={{ height: visibleTimelineRows.length * ROW_H }}
            >
              {virtualRows.map((vr) => {
                const row = visibleTimelineRows[vr.index];
                return (
                  <div
                    key={row.itemId}
                    data-index={vr.index}
                    ref={rowVirtualizer.measureElement}
                    className="absolute top-0 left-0 w-full"
                    style={{
                      transform: `translateY(${vr.start - rowScrollMargin}px)`,
                    }}
                  >
                    <GanttRowItem
                      row={row}
                      criticalLabel={effectiveCriticalLabel(
                        priorityColumn
                          ? (cellMap.get(
                              cellKey(row.itemId, priorityColumn.id),
                            ) ?? null)
                          : null,
                        dependentsByItem.get(row.itemId) ?? 0,
                      )}
                      rowIdx={vr.index}
                      totalW={totalW}
                      dayW={dayW}
                      todayOffset={todayOffset}
                      dayCount={dayCount}
                      startColumnId={startSourceId ?? resolvedDateColumn.id}
                      endColumnId={endSourceId}
                      readOnly={readOnly}
                      isExpanded={expanded.has(row.itemId)}
                      onToggleExpand={toggleExpand}
                      color={rowColors.get(row.itemId) ?? null}
                      allRows={scheduledRows}
                      dependencies={cache.dependencies}
                      violations={violations}
                      onBarResized={(itemId, newEndISO, range) =>
                        onBarResized(
                          itemId,
                          newEndISO,
                          range,
                          startSourceId ?? resolvedDateColumn.id,
                          endSourceId,
                          mutations.setCell as Parameters<
                            typeof onBarResized
                          >[5],
                        )
                      }
                      addDependency={mutations.addDependency}
                      removeDependency={mutations.removeDependency}
                      onItemTap={handleItemTap}
                    />
                  </div>
                );
              })}

              {/* SVG dependency arrow overlay (clamped to the rendered window) */}
              {clampedArrows.length > 0 && (
                <svg
                  className="pointer-events-none absolute inset-0"
                  style={{
                    width: LABEL_W + totalW,
                    height: visibleTimelineRows.length * ROW_H,
                  }}
                  aria-hidden
                >
                  {clampedArrows.map(
                    ({ dep, predIdx, succIdx, predRow, succRow }) => {
                      const isViolation = violations.has(dep.id);
                      const predEndX =
                        LABEL_W +
                        ((predRow.startCol ?? 0) + (predRow.spanCols ?? 1)) *
                          dayW;
                      const predMidY = predIdx * ROW_H + ROW_H / 2;
                      const succStartX =
                        LABEL_W + (succRow.startCol ?? 0) * dayW;
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
