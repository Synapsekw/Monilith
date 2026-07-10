"use client";

import { useDraggable } from "@dnd-kit/core";
import type { KeyboardEvent, MouseEvent } from "react";
import { cn } from "@/lib/utils";
import type { BoardCache, CacheColumn } from "@/lib/boards/cache";
import { cellKey } from "@/lib/boards/cache";
import { ColorChip } from "@/components/ui/color-chip";
import { presenceTarget } from "@/lib/boards/presence-target";
import { usePresenceFocus } from "@/lib/boards/use-presence-focus";
import { PresenceRing } from "@/components/boards/presence/PresenceRing";
import type { PlacedInterval } from "@/lib/boards/calendar";
import type { ColumnOption } from "@/lib/validations/boards";

export type ChipDragData = {
  itemId: string;
  fromDayISO: string;
  dateColumnId: string;
};

type CellMap = Map<string, BoardCache["cellValues"][number]["value"]>;

/** Resolve the status option color for an item, or null when unset. */
export function statusOptionColor(
  statusColumn: CacheColumn | undefined,
  cellMap: CellMap,
  itemId: string,
): string | null {
  if (!statusColumn) return null;
  const value = cellMap.get(cellKey(itemId, statusColumn.id)) as
    | { optionId: string | null }
    | undefined;
  const optionId = value?.optionId ?? null;
  if (!optionId) return null;
  const options =
    (statusColumn.settings as { options?: ColumnOption[] } | null)?.options ??
    [];
  return options.find((o) => o.id === optionId)?.color ?? null;
}

export function EventBar({
  interval,
  fromDayISO,
  weekStartISO,
  dateColumnId,
  statusColumn,
  cellMap,
  onOpen,
}: {
  interval: PlacedInterval;
  fromDayISO: string;
  weekStartISO: string;
  dateColumnId: string;
  statusColumn: CacheColumn | undefined;
  cellMap: CellMap;
  /** Tap/Enter on the chip — receives the chip's viewport rect so the parent
   * can anchor the quick-edit peek to it. */
  onOpen?: (itemId: string, anchorRect: DOMRect) => void;
}) {
  const dragData: ChipDragData = {
    itemId: interval.itemId,
    fromDayISO,
    dateColumnId,
  };
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: `${interval.itemId}-${weekStartISO}`, data: dragData });

  const target = presenceTarget.event(interval.itemId);
  usePresenceFocus({ viewKind: "calendar", targetId: target }, isDragging);

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  const color = statusOptionColor(statusColumn, cellMap, interval.itemId);
  // Spans continuing past a week edge lose their rounded cap on that side.
  const roundLeft = !interval.continuesLeft;
  const roundRight = !interval.continuesRight;
  // The name renders once, at the visible start of the span.
  const showName = !interval.continuesLeft;

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      onOpen?.(interval.itemId, e.currentTarget.getBoundingClientRect());
    }
  };

  const common = cn(
    "relative flex h-[18px] min-w-0 cursor-grab items-center gap-1.5 text-[11px] font-medium",
    "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
    isDragging && "opacity-50",
    roundLeft ? "rounded-l-sm" : "rounded-l-none",
    roundRight ? "rounded-r-sm" : "rounded-r-none",
  );

  const onChipClick = (e: MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    onOpen?.(interval.itemId, e.currentTarget.getBoundingClientRect());
  };

  if (interval.isSingle) {
    return (
      <div
        ref={setNodeRef}
        style={style}
        {...listeners}
        {...attributes}
        tabIndex={0}
        aria-label={interval.name}
        onClick={onChipClick}
        onKeyDown={handleKeyDown}
        className={cn(common, "bg-surface-muted border-border border px-1.5")}
      >
        <PresenceRing target={target} />
        {color && (
          <span
            aria-hidden
            className="size-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: color }}
          />
        )}
        <span className="truncate">{interval.name}</span>
      </div>
    );
  }

  // Multi-day span with a status color: a soft translucent ColorChip fills the
  // bar (no opaque inline fill). The wrapper stays the draggable/clickable shell.
  if (color) {
    return (
      <div
        ref={setNodeRef}
        style={style}
        {...listeners}
        {...attributes}
        tabIndex={0}
        aria-label={interval.name}
        onClick={onChipClick}
        onKeyDown={handleKeyDown}
        className={cn(common, "overflow-hidden")}
      >
        <PresenceRing target={target} />
        <ColorChip
          color={color}
          className="h-full w-full items-center rounded-sm px-1.5 hover:-translate-y-px hover:brightness-110"
        >
          {showName ? interval.name : ""}
        </ColorChip>
      </div>
    );
  }

  // Multi-day span without a status color: neutral surface fallback.
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      tabIndex={0}
      aria-label={interval.name}
      onClick={onChipClick}
      onKeyDown={handleKeyDown}
      className={cn(common, "bg-surface-muted border-border border px-1.5")}
    >
      <PresenceRing target={target} />
      {showName && <span className="truncate">{interval.name}</span>}
    </div>
  );
}
