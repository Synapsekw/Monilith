"use client";

import { useMemo, useRef, type CSSProperties } from "react";
import { useDraggable } from "@dnd-kit/core";
import { MoreHorizontal } from "lucide-react";

import { cn } from "@/lib/utils";
import type { CacheDependency } from "@/lib/boards/cache";
import type { GanttRow } from "@/lib/boards/gantt";
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
  DAY_W,
  LABEL_W,
  MILESTONE,
  ROW_H,
  formatISO,
  parseISO,
  type BarDragData,
} from "@/components/boards/gantt/utils";

export function GanttRowItem({
  row,
  criticalLabel,
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
  onItemTap,
}: {
  row: GanttRow;
  /** Effective-critical marker text (see effectiveCriticalLabel), or null. */
  criticalLabel: string | null;
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
  /** Plain tap (no drag activated) on the bar body or milestone — carries the
   * element's rect so the board can anchor the quick-edit peek. */
  onItemTap: (itemId: string, anchorRect: DOMRect) => void;
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

  // Keystone soft-pill treatment for an arbitrary option color: a 15% tint of
  // the hue over the surface with per-theme AA-clamped text (mirrors ColorChip /
  // OptionPill). The bar hosts children (drag handle, resize strip, presence
  // ring), so we replicate ColorChip's CSS-var contract inline rather than
  // nesting the primitive.
  const soft = color ? softPillText(color) : null;

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
      className="group hover:bg-accent/5 flex border-b"
      style={{ height: ROW_H }}
    >
      {/* Sticky name label */}
      <div
        className="bg-background sticky left-0 z-10 flex shrink-0 items-center border-r px-4"
        style={{ width: LABEL_W }}
      >
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
              className="text-muted-foreground hover:text-foreground size-6 opacity-0 group-hover:opacity-100 pointer-coarse:size-11 pointer-coarse:opacity-100"
            >
              <MoreHorizontal className="size-3.5" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            {otherItems.length > 0 && (
              <>
                <div className="px-2 py-1">
                  <Kicker>Blocked by…</Kicker>
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
              "shadow-card absolute flex cursor-grab items-center rounded-sm transition-[filter] duration-200 hover:brightness-110",
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
              {...listeners}
              {...attributes}
              role="button"
              tabIndex={0}
              aria-label={row.name}
              onClick={handleTap}
              onKeyDown={handleTapKeyDown}
              className="flex h-full flex-1 items-center overflow-hidden px-2"
            >
              <span
                className={cn(
                  "truncate text-[11px] font-medium",
                  color
                    ? "text-[color:var(--pill-fg-light)] dark:text-[color:var(--pill-fg-dark)]"
                    : "text-primary-foreground",
                )}
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
              className="hover:bg-primary-foreground/20 h-full w-2 cursor-ew-resize touch-none rounded-r-sm pointer-coarse:w-11"
              aria-label={`Resize ${row.name}`}
            />
          </div>
        )}
      </div>
    </div>
  );
}
