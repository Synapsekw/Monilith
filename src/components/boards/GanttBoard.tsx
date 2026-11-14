"use client";

import { memo, useRef, useState, useTransition, useMemo } from "react";
import { CalendarDays, GanttChartSquare } from "lucide-react";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { BoardPayload } from "@/lib/boards/queries";
import { buildCellMap, cellKey } from "@/lib/boards/cache";
import { buildDependentsCountMap } from "@/lib/boards/priority";
import { useDependencyContext } from "@/lib/boards/use-dependency-context";
import { crossBoardStubs } from "@/lib/boards/cross-board";
import { contextSpans } from "@/lib/boards/timeline-context";
import { scheduleFromPicks } from "@/lib/boards/schedule";
import { useBoardCache } from "@/lib/boards/use-board-cache";
import { useBoardMutations } from "@/lib/boards/use-board-mutations";
import { useBoardViewPrefs } from "@/lib/boards/view-prefs-context";
import { useIntelItemIds } from "@/lib/boards/intelligence/context";
import { narrowItemsToSignal } from "@/lib/boards/intelligence/signals";
import {
  GROUP_ROW_PREFIX,
  UNGROUPED_GROUP_ID,
  buildGanttRows,
  detectViolations,
  groupTimelineRows,
  onBarMoved,
  onBarResized,
  rangeIncludingToday,
  timelineDayCount,
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
import { localTodayISO } from "@/lib/boards/overdue";
import { buildTimelineLate } from "@/lib/boards/timeline-late";
import { updateBoardView } from "@/lib/boards/view-actions";
import { BoardHeader } from "@/components/boards/BoardHeader";
import type { BoardAccess, HeaderGrant } from "@/components/boards/BoardHeader";
import type { EditorMember } from "@/components/boards/cells/editors";
import { NO_GRANTS, NO_MEMBERS } from "@/components/boards/empty-props";
import {
  ItemQuickEdit,
  type QuickEditTarget,
} from "@/components/boards/quick-edit/ItemQuickEdit";
import {
  DEFAULT_LABEL_W,
  LABEL_W_MAX,
  LABEL_W_MIN,
  ZOOM_DAY_COUNT,
  effectiveCriticalLabel,
  type TimelineZoom,
} from "@/components/boards/gantt/utils";
import {
  GanttCanvas,
  type GanttCanvasHandle,
} from "@/components/boards/gantt/GanttCanvas";
import { Button } from "@/components/ui/button";
import { UnscheduledSection } from "@/components/boards/gantt/UnscheduledSection";

// ---------------------------------------------------------------------------
// GanttBoard (main export)
// ---------------------------------------------------------------------------

// Memoized for the same reason as BoardTable / KanbanBoard: it re-renders on
// real cache changes via its own useBoardCache subscription, and every prop
// BoardViews passes is referentially stable, so it can skip the parent
// re-renders driven by presence heartbeats.
export const GanttBoard = memo(GanttBoardInner);

function GanttBoardInner({
  payload,
  selectedViewId,
  members = NO_MEMBERS,
  access = "owner",
  grants = NO_GRANTS,
  currentUserId = "",
}: {
  payload: BoardPayload;
  members?: EditorMember[];
  selectedViewId: string;
  access?: BoardAccess;
  grants?: HeaderGrant[];
  /** Authors optimistic temp rows (see `useBoardMutations`). */
  currentUserId?: string;
}) {
  const { data: cache } = useBoardCache(payload.board.id, payload);
  const mutations = useBoardMutations(payload.board.id, currentUserId);

  const router = useRouter();
  const [, startTransition] = useTransition();

  // Resolve the selected view and its config
  const selectedView = payload.views.find((v) => v.id === selectedViewId);
  const config = (selectedView?.config ?? null) as {
    date_column_id?: string | null;
    end_column_id?: string | null;
    color_column_id?: string | null;
    zoom?: TimelineZoom;
    label_width?: number;
  } | null;

  const dateColumns = useMemo(
    () => cache.columns.filter((c) => c.kind === "date"),
    [cache.columns],
  );
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
  // Name-rail width: seeded from the view config, saved back on drag end.
  // Clamped and rounded on the way in, so an out-of-range stored value renders
  // clamped and is never written back unclamped (the schema would reject the
  // whole config).
  const [labelWidth, setLabelWidth] = useState<number>(
    typeof config?.label_width === "number" &&
      Number.isFinite(config.label_width)
      ? Math.min(
          LABEL_W_MAX,
          Math.max(LABEL_W_MIN, Math.round(config.label_width)),
        )
      : DEFAULT_LABEL_W,
  );
  const canvasRef = useRef<GanttCanvasHandle>(null);

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

  // The ids actually used to resolve dates. A timestamp-sourced bar can't be
  // dragged/resized — there's no cell to write.
  const { startSourceId, endSourceId, readOnly } = scheduleFromPicks(
    dateColumns,
    startColId,
    endColId,
  );

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

  // Viewer-local today: the clock the overdue rule and the canvas's today line
  // both use.
  const today = localTodayISO();

  // Earliest scheduled start, or "" when nothing is dated.
  const dataStartISO = useMemo(() => {
    if (!dateColumn || !startSourceId) return "";
    let min = "";
    for (const cv of effectiveCellValues) {
      if (cv.column_id !== startSourceId) continue;
      const d = (cv.value as { date?: unknown } | null)?.date;
      if (typeof d === "string" && (min === "" || d < min)) min = d;
    }
    return min;
  }, [startSourceId, effectiveCellValues, dateColumn]);

  // Latest date across the start and end sources — how far the last bar reaches.
  const dataEndISO = useMemo(() => {
    let max = "";
    for (const cv of effectiveCellValues) {
      if (cv.column_id !== startSourceId && cv.column_id !== endSourceId)
        continue;
      const d = (cv.value as { date?: string } | null)?.date;
      if (typeof d === "string" && d > max) max = d;
    }
    return max;
  }, [startSourceId, endSourceId, effectiveCellValues]);

  // The grid's range: the data range, widened so today - 14 ... today + 30 is
  // always on it. "" (no grid) when the board has no date column; that is the
  // early-return path below.
  const range =
    dateColumn && startSourceId
      ? rangeIncludingToday(dataStartISO || null, dataEndISO || null, today)
      : null;
  const rangeStartISO = range?.startISO ?? "";

  // Grid width in days: the zoom window, extended to fit the full range so
  // bars beyond the window aren't clipped off-screen.
  const dayCount = timelineDayCount(
    rangeStartISO,
    range?.endISO ?? "",
    ZOOM_DAY_COUNT[zoom],
  );

  // Active Intelligence chip → narrow the rows on the timeline. A matching
  // sub-item keeps its parent (narrowItemsToSignal) so it stays nested.
  const intelItemIds = useIntelItemIds();
  const intelItems = useMemo(
    () => narrowItemsToSignal(cache.items, intelItemIds),
    [cache.items, intelItemIds],
  );

  // Build Gantt row layout (positions all items on the timeline).
  const ganttResult = useMemo(() => {
    if (!dateColumn || !rangeStartISO || !startSourceId) return null;
    return buildGanttRows(
      intelItems,
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
    intelItems,
    effectiveCellValues,
    dayCount,
    zoom,
  ]);

  const rows = useMemo(() => ganttResult?.rows ?? [], [ganttResult]);

  // Detect dependency violations (finish-to-start constraint check).
  // Only same-board links are arrows; cross-board links become stubs below.
  const localIds = useMemo(
    () => new Set(cache.items.map((i) => i.id)),
    [cache.items],
  );
  const intraDeps = useMemo(
    () =>
      cache.dependencies.filter(
        (d) => localIds.has(d.predecessor_id) && localIds.has(d.successor_id),
      ),
    [cache.dependencies, localIds],
  );
  const violations = useMemo(
    () => detectViolations(rows, intraDeps),
    [rows, intraDeps],
  );

  const ctx = useDependencyContext(payload.board.id, cache.dependencies);
  const localSpans = useMemo(
    () =>
      new Map(
        rows.map((r) => [
          r.itemId,
          r.startISO && r.endISO
            ? {
                start: r.startISO,
                end: r.endISO,
                isMilestone: !!r.isMilestone,
              }
            : null,
        ]),
      ),
    [rows],
  );
  const externalLinks = useMemo(() => {
    const context = ctx.data ?? { boards: [], items: [] };
    return crossBoardStubs({
      dependencies: cache.dependencies,
      localItemIds: localIds,
      localSpans,
      context,
      contextSpans: contextSpans(context),
    });
  }, [ctx.data, cache.dependencies, localIds, localSpans]);

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
  // sub-items. Group bands collapse through `collapsedGroups`.
  //
  // Both sets are shared with the table view through the view-prefs provider:
  // collapsing a group (or expanding a row) here and switching to Table shows
  // the same thing there, and both survive a reload.
  const {
    collapsedGroups,
    toggleGroupCollapsed,
    expandedItems: expanded,
    toggleItemExpanded: toggleExpand,
  } = useBoardViewPrefs();
  // The trailing "Other items" band (rows whose group is not on the board) is
  // not a real group: its id is not a uuid, and the saved prefs accept only
  // uuids, so its collapse lives here, never in the shared set.
  const [otherCollapsed, setOtherCollapsed] = useState(false);

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
  // Late + done by the Board Intelligence overdue rule (see timeline-late.ts),
  // so a bar's "Nd late" and the overdue chip can never disagree.
  const late = useMemo(
    () =>
      buildTimelineLate({
        items: cache.items,
        columns: cache.columns,
        cellMap,
        todayISO: today,
      }),
    [cache.items, cache.columns, cellMap, today],
  );
  const groupOfItem = useMemo(
    () => new Map(cache.items.map((i) => [i.id, i.group_id])),
    [cache.items],
  );
  // The rows actually drawn on the timeline: a band per group (position
  // order, skipped when empty), then, unless the group is collapsed, its
  // top-level rows plus the sub-items of expanded parents. Virtualization,
  // the rows-area height, and dependency-arrow indexing all key off this list.
  const visibleTimelineRows = useMemo(
    () =>
      groupTimelineRows(timelineRows, groupOfItem, cache.groups, {
        collapsedGroups: otherCollapsed
          ? new Set([...collapsedGroups, UNGROUPED_GROUP_ID])
          : collapsedGroups,
        expanded,
        isDone: late.isDone,
        lateFor: (row) => late.lateDays.get(row.itemId) ?? null,
      }),
    [
      timelineRows,
      groupOfItem,
      cache.groups,
      collapsedGroups,
      otherCollapsed,
      expanded,
      late,
    ],
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

  // A canvas row id is an item id (a parent: its sub-items) or `group:<id>`.
  function isRowExpanded(id: string): boolean {
    if (!id.startsWith(GROUP_ROW_PREFIX)) return expanded.has(id);
    const groupId = id.slice(GROUP_ROW_PREFIX.length);
    return groupId === UNGROUPED_GROUP_ID
      ? !otherCollapsed
      : !collapsedGroups.has(groupId);
  }
  function toggleRow(id: string) {
    if (!id.startsWith(GROUP_ROW_PREFIX)) {
      toggleExpand(id);
      return;
    }
    const groupId = id.slice(GROUP_ROW_PREFIX.length);
    if (groupId === UNGROUPED_GROUP_ID) setOtherCollapsed((c) => !c);
    else toggleGroupCollapsed(groupId);
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
    label_width?: number;
  }) {
    const merged = {
      date_column_id: startColId,
      end_column_id: endColId,
      color_column_id: colorColId,
      zoom,
      // updateBoardView REPLACES the stored config, so the rail width has to
      // ride along on every save or a zoom change would erase it.
      label_width: labelWidth,
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

  function handleLabelWidthChange(width: number) {
    // Synchronous: the canvas has already dropped its live drag width, so the
    // rail must not flash back to the old width for a frame.
    setLabelWidth(width);
    // One write, on drag end (the canvas never calls this mid-drag). A viewer
    // resizes for the session only: the view config is not theirs to write.
    if (access !== "viewer") persistConfig({ label_width: width });
  }

  // Bar move / resize write back through the board's date source(s).
  const startWriteId = startSourceId ?? resolvedDateColumn.id;
  function handleMoveBar(itemId: string, deltaDays: number) {
    const range = itemDateRange(itemId, cache.cellValues, startWriteId);
    if (!range) return;
    onBarMoved(
      itemId,
      deltaDays,
      range,
      startWriteId,
      endSourceId,
      mutations.setCell as Parameters<typeof onBarMoved>[5],
    );
  }
  function handleResizeBar(itemId: string, newEndISO: string) {
    // Same range the row item used to hand back: the row's own resolved span.
    const row = rows.find((r) => r.itemId === itemId);
    const range = { start: row?.startISO ?? "", end: row?.endISO ?? "" };
    onBarResized(
      itemId,
      newEndISO,
      range,
      startWriteId,
      endSourceId,
      mutations.setCell as Parameters<typeof onBarResized>[5],
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

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="text-xs"
          onClick={() => canvasRef.current?.scrollToToday()}
        >
          Today
        </Button>

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

      {/* Gantt grid (+ Unscheduled section underneath) */}
      <GanttCanvas
        rows={visibleTimelineRows}
        dependencies={intraDeps}
        violations={violations}
        externalLinks={externalLinks}
        rangeStartISO={rangeStartISO}
        dayCount={dayCount}
        zoom={zoom}
        handleRef={canvasRef}
        labelWidth={labelWidth}
        onLabelWidthChange={handleLabelWidthChange}
        colorFor={(row) => rowColors.get(row.itemId) ?? null}
        criticalLabelFor={(itemId) =>
          effectiveCriticalLabel(
            priorityColumn
              ? (cellMap.get(cellKey(itemId, priorityColumn.id)) ?? null)
              : null,
            dependentsByItem.get(itemId) ?? 0,
          )
        }
        canEditItem={() => !readOnly}
        lateFor={(row) => late.lateDays.get(row.itemId) ?? null}
        isExpanded={isRowExpanded}
        onToggleExpand={toggleRow}
        onMoveBar={handleMoveBar}
        onResizeBar={handleResizeBar}
        onAddDependency={(vars) =>
          mutations.addDependency(vars, {
            onError: (err) => toast.error(err.message),
          })
        }
        onRemoveDependency={mutations.removeDependency}
        // Arrows here are same-board links only (cross-board ones are stubs),
        // so removal follows this board's access.
        canRemoveDependency={() => access !== "viewer"}
        linkCandidates={(row) =>
          scheduledRows
            .filter((o) => o.itemId !== row.itemId)
            .map((o) => ({ itemId: o.itemId, name: o.name }))
        }
        onItemTap={handleItemTap}
        onStubTap={(s) => router.push(`/boards/${s.boardId}?item=${s.itemId}`)}
        footer={
          <UnscheduledSection
            rows={unscheduledRows}
            onItemTap={handleItemTap}
          />
        }
      />

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
