"use client";

import {
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type Ref,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { DndContext, type DragEndEvent } from "@dnd-kit/core";
import { ChevronDown, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { useTouchAwareSensors } from "@/lib/dnd/sensors";
import type { GanttDependency, GanttRow } from "@/lib/boards/gantt";
import { Kicker } from "@/components/ui/kicker";
import {
  DEFAULT_LABEL_W,
  LABEL_W_MAX,
  LABEL_W_MIN,
  ROW_H,
  PX_PER_DAY,
  fittedDayW,
  buildMonthTicks,
  buildQuarterTicks,
  parseISO,
  todayISO,
  todayScrollLeft,
  weekendStripes,
  type BarDragData,
  type TimelineZoom,
} from "@/components/boards/gantt/utils";
import { GanttRowItem } from "@/components/boards/gantt/GanttRowItem";
import { NameResizeHandle } from "@/components/boards/table/NameResizeHandle";
import type { ExternalLinkStub } from "@/components/boards/gantt/LinkStubs";

// useLayoutEffect warns during SSR; this client component still pre-renders on
// the server, so fall back to useEffect there (same guard as GroupSection).
const useIsoLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

/** What a toolbar may ask of the canvas without reaching into its scroller. */
export type GanttCanvasHandle = {
  /** Smooth-scroll so today sits TODAY_ANCHOR across the visible track. */
  scrollToToday: () => void;
};

export type GanttCanvasProps = {
  /** Rows already in display order (items, optionally section rows). */
  rows: GanttRow[];
  /** Links whose both ends are in `rows` — drawn as arrows. */
  dependencies: GanttDependency[];
  /** Late link ids (from detectViolations or cross-board logic). */
  violations: ReadonlySet<string>;
  /** Cross-board / out-of-view links per item id — drawn as stubs on the bar. */
  externalLinks?: ReadonlyMap<string, ExternalLinkStub[]>;
  rangeStartISO: string;
  dayCount: number;
  zoom: TimelineZoom;
  /** Bar color for a row; null keeps the default primary fill. */
  colorFor: (row: GanttRow) => string | null;
  criticalLabelFor?: (itemId: string) => string | null;
  canEditItem: (itemId: string) => boolean;
  /** Expanded parents; for a board band (section level 0), whether it is open. */
  isExpanded?: (itemId: string) => boolean;
  /** Toggles a parent's sub-items — and, when given, collapses a board band. */
  onToggleExpand?: (itemId: string) => void;
  onMoveBar: (itemId: string, deltaDays: number) => void;
  onResizeBar: (itemId: string, newEndISO: string) => void;
  onAddDependency: (vars: {
    predecessorId: string;
    successorId: string;
  }) => void;
  onRemoveDependency: (vars: { dependencyId: string }) => void;
  /** Whether the viewer may remove this link (edit on either end's board).
   * False hides the row's "Remove dep" entries. */
  canRemoveDependency: (dep: GanttDependency) => boolean;
  /** Items offered in a row's "Blocked by…" picker. */
  linkCandidates: (row: GanttRow) => { itemId: string; name: string }[];
  onItemTap: (itemId: string, anchorRect: DOMRect) => void;
  onStubTap: (stub: ExternalLinkStub) => void;
  /** Rendered under the rows (board Gantt passes UnscheduledSection). */
  footer?: ReactNode;
  /** Width of the name rail in px. Defaults to DEFAULT_LABEL_W (300). */
  labelWidth?: number;
  /** Given → the rail header shows a drag handle. Called ONCE on drag end with
   * an integer clamped to LABEL_W_MIN..LABEL_W_MAX, and with DEFAULT_LABEL_W on
   * double-click. Never called while dragging. */
  onLabelWidthChange?: (width: number) => void;
  /** Imperative handle (a plain prop, not `ref`): the toolbar's Today button. */
  handleRef?: Ref<GanttCanvasHandle>;
};

/**
 * Board-agnostic timeline canvas: sticky header ticks + today line, the
 * virtualized name-rail/track rows, bar drag (move) and resize, dependency
 * arrows and cross-board link stubs. Owns no data — every write goes out
 * through the `on*` callbacks, so the board Gantt and the folder Timeline can
 * both wrap it.
 */
export function GanttCanvas({
  rows,
  dependencies,
  violations,
  externalLinks,
  rangeStartISO,
  dayCount,
  zoom,
  colorFor,
  criticalLabelFor,
  canEditItem,
  isExpanded,
  onToggleExpand,
  onMoveBar,
  onResizeBar,
  onAddDependency,
  onRemoveDependency,
  canRemoveDependency,
  linkCandidates,
  onItemTap,
  onStubTap,
  footer,
  labelWidth,
  onLabelWidthChange,
  handleRef,
}: GanttCanvasProps) {
  const dndId = useId();
  // dnd-kit sensors — shared touch-aware setup (PointerSensor 6px + TouchSensor
  // long-press lift) so a finger can move bars on iPad while a quick swipe scrolls.
  const sensors = useTouchAwareSensors();

  // Header tick labels. Year zoom uses coarser quarter ticks (monthly ticks
  // would cram together at ~1.5px/day); every other level keeps month ticks.
  const headerTicks = useMemo(() => {
    if (!rangeStartISO) return [];
    return zoom === "year"
      ? buildQuarterTicks(rangeStartISO, dayCount)
      : buildMonthTicks(rangeStartISO, dayCount);
  }, [rangeStartISO, dayCount, zoom]);

  // Live width while the rail handle is dragged (local state only — the parent
  // hears about it once, on release).
  const [liveLabelW, setLiveLabelW] = useState<number | null>(null);
  const labelW =
    liveLabelW ??
    Math.min(LABEL_W_MAX, Math.max(LABEL_W_MIN, labelWidth ?? DEFAULT_LABEL_W));

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
    () => new Map(rows.map((r, i) => [r.itemId, i])),
    [rows],
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
    const width = scroller.clientWidth - labelW;
    setTrackWidth((prev) => (prev === width ? prev : width));
  });

  // Re-fit the day scale when the viewport resizes (sidebar toggle, window
  // resize) — the layout effect above only reruns on React renders, so observe
  // the scroller directly to keep the grid filling the available width.
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const width = scroller.clientWidth - labelW;
      setTrackWidth((prev) => (prev === width ? prev : width));
    });
    ro.observe(scroller);
    return () => ro.disconnect();
  }, [labelW]);
  // React Compiler safely skips memoizing this component because useVirtualizer
  // returns non-memoizable functions; that fallback is correct here.
  // eslint-disable-next-line react-hooks/incompatible-library
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    scrollMargin: rowScrollMargin,
    estimateSize: () => ROW_H,
    overscan: 6,
    // getBoundingClientRect().height returns 0 in jsdom — fall back to ROW_H so
    // tests don't collapse every virtual row to 0px.
    measureElement: (el) => el.getBoundingClientRect().height || ROW_H,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();

  // Build dependency arrow geometry data. Section rows carry no bar, so the
  // startCol/spanCols guards below already skip them.
  const arrowLines = useMemo(
    () =>
      dependencies
        .map((dep) => {
          const predIdx = rowIndexMap.get(dep.predecessor_id);
          const succIdx = rowIndexMap.get(dep.successor_id);
          const predRow = rows[predIdx ?? -1];
          const succRow = rows[succIdx ?? -1];
          if (predIdx === undefined || succIdx === undefined) return null;
          if (predRow?.startCol === undefined || predRow.spanCols === undefined)
            return null;
          if (succRow?.startCol === undefined) return null;
          return { dep, predIdx, succIdx, predRow, succRow };
        })
        .filter(Boolean) as {
        dep: GanttDependency;
        predIdx: number;
        succIdx: number;
        predRow: GanttRow;
        succRow: GanttRow;
      }[],
    [dependencies, rowIndexMap, rows],
  );

  // B3b — clamp the arrow overlay to arrows with an endpoint inside the rendered
  // window (virtualRows already includes the overscan band). Endpoint→coordinate
  // math still uses the absolute whole-set index (predIdx * ROW_H), so positions
  // stay correct regardless of what's mounted; this just skips drawing arrows
  // that are entirely off-window.
  const visibleFirst = virtualRows[0]?.index ?? 0;
  const visibleLast =
    virtualRows[virtualRows.length - 1]?.index ?? rows.length - 1;
  const clampedArrows = arrowLines.filter(
    ({ predIdx, succIdx }) =>
      (predIdx >= visibleFirst && predIdx <= visibleLast) ||
      (succIdx >= visibleFirst && succIdx <= visibleLast),
  );

  const today = todayISO();
  const todayOffset = rangeStartISO
    ? Math.round((parseISO(today) - parseISO(rangeStartISO)) / 86_400_000)
    : -1;
  const todayInRange = todayOffset >= 0 && todayOffset <= dayCount;

  // Open on today. Runs after the first layout that has a real track width,
  // and again when the zoom changes (a new dayW makes the old offset
  // meaningless). Keyed by zoom through a ref — NOT by the data — so a drag,
  // a collapse or a realtime edit that shifts the range never moves the
  // viewport out from under the user.
  const scrolledForZoom = useRef<TimelineZoom | null>(null);
  useIsoLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || trackWidth <= 0 || !todayInRange) return;
    if (scrolledForZoom.current === zoom) return;
    scrolledForZoom.current = zoom;
    scroller.scrollLeft = todayScrollLeft(todayOffset, dayW, trackWidth);
  }, [zoom, trackWidth, todayInRange, todayOffset, dayW]);

  useImperativeHandle(
    handleRef,
    () => ({
      scrollToToday() {
        const scroller = scrollRef.current;
        if (!scroller || !todayInRange) return;
        const left = todayScrollLeft(
          todayOffset,
          dayW,
          Math.max(0, trackWidth),
        );
        // An explicit smooth scroll ignores the global reduced-motion CSS rule.
        const reduce =
          typeof window.matchMedia === "function" &&
          window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        // Element.scrollTo is missing in some embedded webviews (and jsdom).
        if (typeof scroller.scrollTo === "function")
          scroller.scrollTo({ left, behavior: reduce ? "auto" : "smooth" });
        else scroller.scrollLeft = left;
      },
    }),
    [todayInRange, todayOffset, dayW, trackWidth],
  );

  // Weekend shading, computed once per canvas and handed to every track.
  const trackStyle = useMemo(
    () => weekendStripes(rangeStartISO, dayW, zoom),
    [rangeStartISO, dayW, zoom],
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, delta } = event;
    const data = active.data.current as BarDragData | undefined;
    if (!data || data.kind !== "bar") return;
    if (!canEditItem(data.itemId)) return; // read-only bars can't be moved
    const deltaDays = Math.round(delta.x / dayW);
    if (deltaDays === 0) return;
    onMoveBar(data.itemId, deltaDays);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <DndContext id={dndId} sensors={sensors} onDragEnd={handleDragEnd}>
        <div
          data-scroll-container
          ref={scrollRef}
          className="min-h-0 flex-1 overflow-auto"
        >
          <div className="inline-block min-w-full">
            {/* Sticky header row */}
            <div className="bg-background sticky top-0 z-20 flex border-b">
              {/* Name rail header */}
              <div
                data-testid="gantt-rail-header"
                className="bg-background hover:border-border-hover sticky left-0 z-10 flex shrink-0 items-center border-r px-4 py-2.5"
                style={{ width: labelW }}
              >
                <Kicker>Item</Kicker>
                {onLabelWidthChange && (
                  <NameResizeHandle
                    width={labelW}
                    min={LABEL_W_MIN}
                    max={LABEL_W_MAX}
                    label="Resize name rail (double-click to reset)"
                    onResize={setLiveLabelW}
                    onResizeEnd={(w) => {
                      setLiveLabelW(null);
                      onLabelWidthChange(w);
                    }}
                    onAutoFit={() => {
                      setLiveLabelW(null);
                      onLabelWidthChange(DEFAULT_LABEL_W);
                    }}
                  />
                )}
              </div>
              {/* Timeline header */}
              <div
                data-testid="gantt-track-header"
                className="relative"
                style={{ width: totalW, height: 38 }}
              >
                {/* Header tick labels (month, or quarter at Year zoom) */}
                {headerTicks.map((tick) => (
                  <div
                    key={tick.dayOffset}
                    className="text-muted-foreground text-2xs absolute top-0 h-full border-l pt-2 pl-1.5 whitespace-nowrap"
                    style={{ left: tick.dayOffset * dayW }}
                  >
                    {tick.label}
                  </div>
                ))}
                {/* Today line */}
                {todayInRange && (
                  <div
                    className="bg-destructive/70 absolute top-0 z-10 h-full w-px"
                    style={{ left: todayOffset * dayW }}
                    aria-label="Today"
                  />
                )}
              </div>
            </div>

            {/* Rows (windowed) with SVG arrow overlay. The spacer div holds the
                full timeline height so scroll geometry is unchanged; each row
                is absolutely positioned at its virtual offset. */}
            <div
              ref={rowsAreaRef}
              className="relative"
              style={{ height: rows.length * ROW_H }}
            >
              {virtualRows.map((vr) => {
                const row = rows[vr.index];
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
                    {row.kind === "section" ? (
                      <SectionBand
                        row={row}
                        totalW={totalW}
                        labelW={labelW}
                        dayW={dayW}
                        todayOffset={todayOffset}
                        todayInRange={todayInRange}
                        trackStyle={trackStyle}
                        expanded={isExpanded?.(row.itemId) ?? true}
                        onToggle={onToggleExpand}
                      />
                    ) : (
                      <GanttRowItem
                        row={row}
                        criticalLabel={criticalLabelFor?.(row.itemId) ?? null}
                        rowIdx={vr.index}
                        totalW={totalW}
                        labelW={labelW}
                        trackStyle={trackStyle}
                        dayW={dayW}
                        todayOffset={todayOffset}
                        todayInRange={todayInRange}
                        readOnly={!canEditItem(row.itemId)}
                        isExpanded={isExpanded?.(row.itemId) ?? false}
                        onToggleExpand={onToggleExpand}
                        color={colorFor(row)}
                        getLinkCandidates={() => linkCandidates(row)}
                        dependencies={dependencies}
                        violations={violations}
                        onResize={onResizeBar}
                        onAddDependency={onAddDependency}
                        onRemoveDependency={onRemoveDependency}
                        canRemoveDependency={canRemoveDependency}
                        onItemTap={onItemTap}
                        stubs={externalLinks?.get(row.itemId)}
                        onStubTap={onStubTap}
                      />
                    )}
                  </div>
                );
              })}

              {/* SVG dependency arrow overlay (clamped to the rendered window) */}
              {clampedArrows.length > 0 && (
                <svg
                  className="pointer-events-none absolute inset-0"
                  style={{
                    width: labelW + totalW,
                    height: rows.length * ROW_H,
                  }}
                  aria-hidden
                >
                  {clampedArrows.map(
                    ({ dep, predIdx, succIdx, predRow, succRow }) => {
                      const isViolation = violations.has(dep.id);
                      const predEndX =
                        labelW +
                        ((predRow.startCol ?? 0) + (predRow.spanCols ?? 1)) *
                          dayW;
                      const predMidY = predIdx * ROW_H + ROW_H / 2;
                      const succStartX =
                        labelW + (succRow.startCol ?? 0) * dayW;
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

      {footer}
    </div>
  );
}

/**
 * A label band spanning the whole row — a board (level 0, the stronger surface
 * step) or a group (level 1, lighter, indented). No bar, no picker; the name
 * stays pinned to the rail while the track scrolls sideways. A board band
 * becomes a collapse toggle when the canvas is given `onToggleExpand`.
 */
function SectionBand({
  row,
  totalW,
  labelW,
  dayW,
  todayOffset,
  todayInRange,
  trackStyle,
  expanded,
  onToggle,
}: {
  row: GanttRow;
  totalW: number;
  labelW: number;
  dayW: number;
  todayOffset: number;
  todayInRange: boolean;
  trackStyle?: CSSProperties;
  expanded: boolean;
  onToggle?: (itemId: string) => void;
}) {
  const isBoard = (row.level ?? 0) === 0;
  const label = (
    <span
      role="heading"
      aria-level={isBoard ? 3 : 4}
      title={row.name}
      className={cn(
        "min-w-0 truncate text-xs",
        isBoard
          ? "text-foreground font-semibold"
          : "text-muted-foreground font-medium",
      )}
    >
      {row.name}
    </span>
  );
  return (
    <div
      data-testid="gantt-section"
      className={cn(
        "flex border-b",
        isBoard ? "bg-surface-muted" : "bg-surface",
      )}
      style={{ height: ROW_H, width: labelW + totalW }}
    >
      <div
        className={cn(
          "sticky left-0 z-10 flex min-w-0 shrink-0 items-center pr-2",
          isBoard ? "bg-surface-muted" : "bg-surface",
        )}
        style={{
          width: labelW,
          paddingLeft: isBoard && onToggle ? 8 : isBoard ? 16 : 32,
        }}
      >
        {isBoard && onToggle ? (
          <button
            type="button"
            onClick={() => onToggle(row.itemId)}
            aria-expanded={expanded}
            aria-label={`${expanded ? "Collapse" : "Expand"} ${row.name}`}
            className="hover:bg-state-hover focus-visible:ring-ring flex h-7 min-w-0 flex-1 items-center gap-1 rounded-sm px-1 text-left focus-visible:ring-2 focus-visible:outline-none pointer-coarse:h-11"
          >
            {expanded ? (
              <ChevronDown
                className="text-muted-foreground size-3.5 shrink-0"
                aria-hidden
              />
            ) : (
              <ChevronRight
                className="text-muted-foreground size-3.5 shrink-0"
                aria-hidden
              />
            )}
            {label}
          </button>
        ) : (
          label
        )}
      </div>
      {/* The band's track: same weekend tint and today hairline as an item
          row, so the today line reads as one unbroken rule down the chart. */}
      <div
        data-testid="gantt-section-track"
        className="relative shrink-0"
        style={{ width: totalW, height: ROW_H, ...trackStyle }}
      >
        {todayInRange && (
          <div
            data-today-line
            className="bg-destructive/30 absolute top-0 h-full w-px"
            style={{ left: todayOffset * dayW }}
            aria-hidden
          />
        )}
      </div>
    </div>
  );
}
