"use client";

import { useMemo, useRef, useState, type CSSProperties } from "react";
import { useDraggable } from "@dnd-kit/core";
import { ChevronDown, ChevronRight, MoreHorizontal } from "lucide-react";

import { cn } from "@/lib/utils";
import type { GanttDependency, GanttRow } from "@/lib/boards/gantt";
import {
  LinkStubs,
  placeLinkStubs,
  type ExternalLinkStub,
  type StubSide,
} from "@/components/boards/gantt/LinkStubs";
import {
  intelRowClasses,
  useIntelMatch,
} from "@/lib/boards/intelligence/context";
import { softPillText } from "@/components/boards/cells/soft-pill-color";
import { presenceTarget } from "@/lib/boards/presence-target";
import { usePresenceFocus } from "@/lib/boards/use-presence-focus";
import { PresenceRing } from "@/components/boards/presence/PresenceRing";
import { Button } from "@/components/ui/button";
import { Kicker } from "@/components/ui/kicker";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  BAR_H,
  LABEL_W,
  MILESTONE,
  MIN_BAR_W,
  ROW_H,
  formatISO,
  parseISO,
  type BarDragData,
} from "@/components/boards/gantt/utils";

const NO_STUBS: ExternalLinkStub[] = [];
/** px between a bar's edge and its link stubs. */
const STUB_GAP = 4;

export function GanttRowItem({
  row,
  criticalLabel,
  rowIdx,
  totalW,
  dayW,
  todayOffset,
  dayCount,
  readOnly = false,
  isExpanded = false,
  onToggleExpand,
  color,
  getLinkCandidates,
  dependencies,
  violations,
  onResize,
  onAddDependency,
  onRemoveDependency,
  onItemTap,
  stubs = NO_STUBS,
  onStubTap,
}: {
  row: GanttRow;
  /** Effective-critical marker text (see effectiveCriticalLabel), or null. */
  criticalLabel: string | null;
  rowIdx: number;
  totalW: number;
  /** Pixels per day at the active zoom (see PX_PER_DAY). */
  dayW: number;
  todayOffset: number;
  dayCount: number;
  /** When true the bar can't be dragged/resized (e.g. timestamp-sourced dates). */
  readOnly?: boolean;
  /** For a parent row (row.hasChildren): whether its sub-items are revealed. */
  isExpanded?: boolean;
  onToggleExpand?: (itemId: string) => void;
  color: string | null;
  /** Items offered in the "Blocked by…" picker (already excludes this row).
   * Called only while the ⋯ menu is open — never on scroll/re-render. */
  getLinkCandidates: () => { itemId: string; name: string }[];
  dependencies: readonly GanttDependency[];
  violations: ReadonlySet<string>;
  /** Commit a right-edge resize to a new end date. */
  onResize: (itemId: string, newEndISO: string) => void;
  onAddDependency: (vars: {
    predecessorId: string;
    successorId: string;
  }) => void;
  onRemoveDependency: (vars: { dependencyId: string }) => void;
  /** Plain tap (no drag activated) on the bar body or milestone — carries the
   * element's rect so the board can anchor the quick-edit peek. */
  onItemTap: (itemId: string, anchorRect: DOMRect) => void;
  /** Cross-board / out-of-view links drawn as chips beside the bar. */
  stubs?: ExternalLinkStub[];
  onStubTap?: (stub: ExternalLinkStub) => void;
}) {
  void rowIdx;
  void violations;

  const dragData: BarDragData = {
    kind: "bar",
    itemId: row.itemId,
    startISO: row.startISO ?? "",
    endISO: row.endISO ?? "",
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
  const intelMatch = useIntelMatch(row.itemId);

  const barStyle = transform
    ? { transform: `translate3d(${transform.x}px, 0, 0)` }
    : undefined;

  // Drag is off for read-only (timestamp-sourced) bars — no cell to write back.
  const dragHandlers = readOnly ? {} : { ...listeners, ...attributes };
  const grabCursor = readOnly ? "cursor-default" : "cursor-grab";
  const depth = row.depth ?? 0;

  const barLeft = (row.startCol ?? 0) * dayW;
  // Live resize preview: while the right edge is dragged the bar grows/shrinks
  // from LOCAL state only (no cache patch, no server write); the single commit
  // happens on pointerup. `baseEnd` is the end date the preview was measured
  // against — once the row's end moves away from it (the optimistic patch
  // landed, or a realtime edit arrived) the preview is stale and is dropped
  // during render, so the bar never flashes back to its old width between
  // pointerup and the cache update.
  const [resizePreview, setResizePreview] = useState<{
    baseEnd: string;
    deltaDays: number;
  } | null>(null);
  const currentEndISO = row.endISO ?? row.startISO ?? null;
  if (resizePreview && resizePreview.baseEnd !== currentEndISO) {
    setResizePreview(null);
  }
  const previewDays =
    resizePreview && resizePreview.baseEnd === currentEndISO
      ? resizePreview.deltaDays
      : 0;

  const barWidth = row.isMilestone
    ? BAR_H // diamond
    : Math.max(MIN_BAR_W, ((row.spanCols ?? 1) + previewDays) * dayW);

  // Keystone soft-pill treatment for an arbitrary option color: a 15% tint of
  // the hue over the surface with per-theme AA-clamped text (mirrors ColorChip /
  // OptionPill). The bar hosts children (drag handle, resize strip, presence
  // ring), so we replicate ColorChip's CSS-var contract inline rather than
  // nesting the primitive.
  const soft = color ? softPillText(color) : null;

  // Horizontal extent of the bar/diamond — anchors the link stubs.
  const barStartX = row.isMilestone
    ? barLeft + dayW / 2 - MILESTONE / 2
    : barLeft;
  const barEndX = row.isMilestone ? barStartX + MILESTONE : barLeft + barWidth;
  // Group the stubs by the side they render on. Each direction prefers its
  // natural side but flips (or overlays the bar end) when the clipped track
  // has no room there; groups landing on the same side share one chip row,
  // "waiting on" first.
  const stubGroups = useMemo(() => {
    const waitingOn = stubs.filter((s) => s.direction === "waiting_on");
    const blocking = stubs.filter((s) => s.direction === "blocking");
    const sides = placeLinkStubs({
      barStartX,
      barEndX,
      trackW: totalW,
      gap: STUB_GAP,
      waitingOnCount: waitingOn.length,
      blockingCount: blocking.length,
    });
    const bySide = new Map<StubSide, ExternalLinkStub[]>();
    for (const [group, side] of [
      [waitingOn, sides.waitingOn],
      [blocking, sides.blocking],
    ] as const) {
      if (group.length === 0) continue;
      bySide.set(side, [...(bySide.get(side) ?? []), ...group]);
    }
    return [...bySide];
  }, [stubs, barStartX, barEndX, totalW]);

  // Predecessors of this item (items that must finish before this starts)
  const predecessorDeps = useMemo(
    () => dependencies.filter((d) => d.successor_id === row.itemId),
    [dependencies, row.itemId],
  );

  // Resize state. The refs hold the gesture origin; `resizeDeltaRef` mirrors
  // the previewed day delta so pointerup can commit without reading state.
  const resizeStartXRef = useRef<number | null>(null);
  const resizeStartEndRef = useRef<string | null>(null);
  const resizeDeltaRef = useRef(0);

  function resetResizeGesture() {
    resizeStartXRef.current = null;
    resizeStartEndRef.current = null;
    resizeDeltaRef.current = 0;
  }

  function handleResizeStart(e: React.PointerEvent) {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    resizeStartXRef.current = e.clientX;
    resizeStartEndRef.current = currentEndISO;
    resizeDeltaRef.current = 0;
  }

  /** Preview only — never writes. State changes at most once per day crossed
   * (React bails out when the rounded delta is unchanged). */
  function handleResizeMove(e: React.PointerEvent) {
    const origEnd = resizeStartEndRef.current;
    if (resizeStartXRef.current === null || !origEnd) return;
    // The end moved under the gesture (realtime edit): the origin is stale.
    if (origEnd !== currentEndISO) {
      resetResizeGesture();
      return;
    }
    const rawDays = Math.round((e.clientX - resizeStartXRef.current) / dayW);
    // The end can't cross before the start.
    const minDays = row.startISO
      ? Math.round((parseISO(row.startISO) - parseISO(origEnd)) / 86_400_000)
      : 0;
    const deltaDays = Math.max(rawDays, minDays);
    if (deltaDays === resizeDeltaRef.current) return;
    resizeDeltaRef.current = deltaDays;
    setResizePreview({ baseEnd: origEnd, deltaDays });
  }

  /** Commit exactly once on release; nothing when the date didn't change. The
   * preview is left in place and retires itself when the row's end updates. */
  function handleResizeEnd() {
    const origEnd = resizeStartEndRef.current;
    const deltaDays = resizeDeltaRef.current;
    const active = resizeStartXRef.current !== null && origEnd !== null;
    resetResizeGesture();
    if (!active || !origEnd) return;
    if (deltaDays === 0 || origEnd !== currentEndISO) {
      setResizePreview(null);
      return;
    }
    const newEndISO = formatISO(parseISO(origEnd) + deltaDays * 86_400_000);
    onResize(row.itemId, newEndISO);
  }

  /** Interrupted gesture (pointercancel) — drop the preview, write nothing. */
  function handleResizeCancel() {
    resetResizeGesture();
    setResizePreview(null);
  }

  /** Tap/Enter/Space on the bar body or milestone → quick-edit peek. dnd-kit
   * suppresses the click when a drag actually activated (same behavior the
   * calendar's EventBar relies on), so drags never open it. */
  function handleTap(e: React.MouseEvent | React.KeyboardEvent) {
    onItemTap(
      row.itemId,
      (e.currentTarget as HTMLElement).getBoundingClientRect(),
    );
  }
  function handleTapKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleTap(e);
    }
  }

  return (
    <div
      data-testid="gantt-row"
      data-intel-rule="cell"
      className={cn(
        "group hover:bg-state-hover/5 flex border-b",
        intelRowClasses(intelMatch),
      )}
      style={{ height: ROW_H }}
    >
      {/* Sticky name label */}
      <div
        className={cn(
          "bg-background sticky left-0 z-10 flex shrink-0 items-center border-r pr-2",
          depth > 0 && "bg-surface-sunken",
        )}
        style={{ width: LABEL_W, paddingLeft: 16 + depth * 16 }}
      >
        {intelMatch === true && (
          <span aria-hidden data-testid="intel-rule" className="intel-rule" />
        )}
        {/* Expand/collapse toggle for a parent with scheduled sub-items; a
            same-size spacer otherwise so names stay vertically aligned. */}
        {row.hasChildren ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand?.(row.itemId);
            }}
            aria-expanded={isExpanded}
            aria-label={
              isExpanded
                ? `Collapse sub-items of ${row.name}`
                : `Expand sub-items of ${row.name}`
            }
            className="text-muted-foreground hover:text-foreground mr-1 flex size-4 shrink-0 items-center justify-center rounded pointer-coarse:size-8"
          >
            {isExpanded ? (
              <ChevronDown className="size-3.5" aria-hidden />
            ) : (
              <ChevronRight className="size-3.5" aria-hidden />
            )}
          </button>
        ) : (
          <span className="mr-1 size-4 shrink-0" aria-hidden />
        )}
        {/* Effective-critical dot — minimal marker where dependencies are
            actually drawn (a dot, not a badge; the tooltip + sr text carry
            the meaning, never color alone). */}
        {criticalLabel && (
          <span
            title={criticalLabel}
            className="bg-status-red mr-1.5 inline-block size-1.5 shrink-0 rounded-full"
          >
            <span className="sr-only">{criticalLabel}</span>
          </span>
        )}
        <span className="text-foreground min-w-0 flex-1 truncate text-xs">
          {row.name}
        </span>
        {row.hasChildren && row.childCount ? (
          <span className="text-muted-foreground text-2xs ml-1 shrink-0 tabular-nums">
            {row.childCount}
          </span>
        ) : null}
        {/* ⋯ menu for dependency management */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={`Options for ${row.name}`}
              className="text-muted-foreground hover:text-foreground size-6 opacity-0 group-hover:opacity-100 pointer-coarse:size-11 pointer-coarse:opacity-100"
            >
              <MoreHorizontal className="size-3.5" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <LinkCandidateItems
              getCandidates={getLinkCandidates}
              hasPredecessors={predecessorDeps.length > 0}
              onPick={(predecessorId) =>
                onAddDependency({ predecessorId, successorId: row.itemId })
              }
            />
            {predecessorDeps.map((dep) => (
              <DropdownMenuItem
                key={dep.id}
                variant="destructive"
                onSelect={() => onRemoveDependency({ dependencyId: dep.id })}
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
            style={{ left: todayOffset * dayW }}
            aria-hidden
          />
        )}

        {/* Bar or milestone diamond. A parent "header" row (unscheduled, but
            hosting scheduled sub-items) has no bar — just the name rail + an
            empty track, so its children can nest and collapse under it. */}
        {!row.scheduled ? null : row.isMilestone ? (
          <div
            ref={setNodeRef}
            className={cn(
              "absolute rotate-45 rounded-sm",
              grabCursor,
              color ? "" : "bg-primary",
              isDragging && "opacity-50",
            )}
            style={{
              left: barLeft + dayW / 2 - MILESTONE / 2,
              top: ROW_H / 2 - MILESTONE / 2,
              width: MILESTONE,
              height: MILESTONE,
              ...(color ? { backgroundColor: color } : {}),
              ...barStyle,
            }}
            {...dragHandlers}
            role="button"
            tabIndex={0}
            title={row.name}
            aria-label={row.name}
            onClick={handleTap}
            onKeyDown={handleTapKeyDown}
          >
            <PresenceRing target={target} className="rounded-sm" />
          </div>
        ) : (
          <div
            ref={setNodeRef}
            className={cn(
              "shadow-card absolute flex items-center rounded-sm transition-[filter] duration-200 hover:brightness-110",
              grabCursor,
              color
                ? "bg-[color-mix(in_oklab,var(--pill)_15%,transparent)]"
                : "bg-primary",
              isDragging && "opacity-50",
            )}
            style={{
              left: barLeft,
              top: ROW_H / 2 - BAR_H / 2,
              width: barWidth,
              height: BAR_H,
              ...(color && soft
                ? ({
                    "--pill": color,
                    "--pill-fg-light": soft.light,
                    "--pill-fg-dark": soft.dark,
                  } as CSSProperties)
                : {}),
              ...barStyle,
            }}
          >
            <PresenceRing target={target} />
            {/* Drag handle covering most of the bar; a plain click (no drag
                activated) opens the quick-edit peek. */}
            <div
              {...dragHandlers}
              role="button"
              tabIndex={0}
              aria-label={row.name}
              onClick={handleTap}
              onKeyDown={handleTapKeyDown}
              className="flex h-full flex-1 items-center overflow-hidden px-2"
            >
              <span
                className={cn(
                  "text-2xs truncate font-medium",
                  color
                    ? "text-[color:var(--pill-fg-light)] dark:text-[color:var(--pill-fg-dark)]"
                    : "text-primary-foreground",
                )}
              >
                {row.name}
              </span>
            </div>
            {/* Right-edge resize handle (hidden for read-only bars) */}
            {!readOnly && (
              <div
                onPointerDown={handleResizeStart}
                onPointerMove={handleResizeMove}
                onPointerUp={handleResizeEnd}
                onPointerLeave={handleResizeEnd}
                onPointerCancel={handleResizeCancel}
                className="hover:bg-primary-foreground/20 h-full w-2 cursor-ew-resize touch-none rounded-r-sm pointer-coarse:w-11"
                aria-label={`Resize ${row.name}`}
              />
            )}
          </div>
        )}

        {/* Cross-board / out-of-view link stubs: "waiting on" chips sit left
            of the bar, "blocking" chips to its right — flipped or overlaid on
            the bar end when that side would clip (see placeLinkStubs). */}
        {row.scheduled &&
          onStubTap &&
          stubGroups.map(([side, group]) => (
            <div
              key={side}
              data-stub-side={side}
              className="absolute z-10 flex -translate-y-1/2"
              style={{
                top: ROW_H / 2,
                ...(side === "before"
                  ? { right: totalW - barStartX + STUB_GAP }
                  : side === "after"
                    ? { left: barEndX + STUB_GAP }
                    : { right: Math.max(0, totalW - barEndX) + STUB_GAP }),
              }}
            >
              <LinkStubs stubs={group} onTap={onStubTap} />
            </div>
          ))}
      </div>
    </div>
  );
}

/**
 * The "Blocked by…" picker entries. Rendered inside DropdownMenuContent, which
 * Radix mounts only while the menu is open, so the candidate list is computed
 * lazily on open instead of for every mounted row on every canvas render.
 */
function LinkCandidateItems({
  getCandidates,
  hasPredecessors,
  onPick,
}: {
  getCandidates: () => { itemId: string; name: string }[];
  hasPredecessors: boolean;
  onPick: (predecessorId: string) => void;
}) {
  const candidates = getCandidates();
  if (candidates.length === 0) return null;
  return (
    <>
      <div className="px-2 py-1">
        <Kicker>Blocked by…</Kicker>
      </div>
      {candidates.map((other) => (
        <DropdownMenuItem
          key={other.itemId}
          onSelect={() => onPick(other.itemId)}
        >
          {other.name}
        </DropdownMenuItem>
      ))}
      {hasPredecessors && <DropdownMenuSeparator />}
    </>
  );
}
