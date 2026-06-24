"use client";

import { useState, useTransition, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  DndContext,
  useDraggable,
  useDroppable,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { Plus, Calendar, Users, Hash } from "lucide-react";

import { cn } from "@/lib/utils";
import { pillTextColor } from "@/lib/boards/contrast";
import {
  selectCardColumns,
  isCardCellEmpty,
  type CardColumns,
} from "@/lib/boards/kanban-card";
import type { BoardPayload } from "@/lib/boards/queries";
import type {
  BoardCache,
  CacheCellValue,
  CacheColumn,
  CacheItem,
} from "@/lib/boards/cache";
import type { Json } from "@/types/database.types";
import { useBoardCache } from "@/lib/boards/use-board-cache";
import { useBoardMutations } from "@/lib/boards/use-board-mutations";
import { resolveKanbanGroupColumn } from "@/lib/boards/views";
import {
  buildKanbanColumns,
  NO_STATUS_ID,
  type KanbanColumn,
} from "@/lib/boards/kanban";
import { buildCellMap, cellKey } from "@/lib/boards/cache";
import { updateBoardView } from "@/lib/boards/view-actions";
import { BoardHeader } from "@/components/boards/BoardHeader";
import type { BoardAccess, HeaderGrant } from "@/components/boards/BoardHeader";
import { CellRenderer } from "@/components/boards/cells";
import type { EditorMember } from "@/components/boards/cells/editors";
import { presenceTarget } from "@/lib/boards/presence-target";
import { usePresenceFocus } from "@/lib/boards/use-presence-focus";
import { PresenceRing } from "@/components/boards/presence/PresenceRing";

/**
 * Initial per-slot height estimate for virtualizing Kanban card lists. Cards
 * are variable height (1–2 line title + optional pill row + optional meta
 * footer), so this is only a seed — `measureElement` corrects each slot to its
 * real height once mounted, which keeps absolutely-positioned cards from
 * overlapping. Breakdown of a typical card: p-3 padding (24 px) + two-line
 * title (~38 px) + meta footer (~22 px) + pb-2 gap (8 px) ≈ 92 px.
 */
const CARD_HEIGHT = 92;

/** Leading icon for a card's meta-footer field; null when the value is self-describing. */
function MetaIcon({ kind }: { kind: string }) {
  const cls = "size-3.5 shrink-0";
  if (kind === "date") return <Calendar className={cls} aria-hidden />;
  if (kind === "people") return <Users className={cls} aria-hidden />;
  if (kind === "numbers") return <Hash className={cls} aria-hidden />;
  // percent renders as a labelled bar — an icon would be redundant.
  return null;
}

type Settings = Record<string, unknown>;

/** Mutation handlers shared between drop wiring and per-column quick-add. */
type SetCell = (vars: {
  itemId: string;
  columnId: string;
  value: unknown;
}) => void;
type ClearCell = (vars: { itemId: string; columnId: string }) => void;

/**
 * Pure drop handler — the part of the DnD interaction worth testing (dnd-kit
 * drag is impractical to drive in jsdom, so the wiring around this stays thin).
 * Same-column drops are no-ops; dropping on the No-status column clears the
 * status cell; dropping on an option column writes `{ optionId }`.
 */
export function onCardDropped(
  itemId: string,
  fromColId: string,
  toCol: { id: string; optionId: string | null },
  groupColumnId: string,
  setCell: SetCell,
  clearCellValue: ClearCell,
) {
  if (fromColId === toCol.id) return;
  if (toCol.optionId === null) {
    clearCellValue({ itemId, columnId: groupColumnId });
  } else {
    setCell({
      itemId,
      columnId: groupColumnId,
      value: { optionId: toCol.optionId },
    });
  }
}

/** Shape stashed on a draggable card so onDragEnd can resolve the source. */
type CardDragData = { itemId: string; fromColId: string };

export function KanbanBoard({
  payload,
  selectedViewId,
  members = [],
  access = "owner",
  grants = [],
}: {
  payload: BoardPayload;
  // Org member directory, threaded down to each card's read-only People
  // summary so it renders resolved assignee names (full name → email), with a
  // count-fallback when the directory is empty — matching the Table cell.
  members?: EditorMember[];
  selectedViewId: string;
  access?: BoardAccess;
  grants?: HeaderGrant[];
}) {
  // Hydrate the shared ["board", boardId] cache + realtime exactly like
  // BoardTable so optimistic + realtime patches re-render this view too.
  const { data: cache } = useBoardCache(
    payload.board.id,
    payload as unknown as BoardCache,
  );
  const { setCell, clearCellValue, addItem } = useBoardMutations(
    payload.board.id,
  );

  const router = useRouter();

  // The view config carries the chosen grouping column.
  const selectedView = payload.views.find((v) => v.id === selectedViewId);
  const config = (selectedView?.config ?? null) as {
    group_column_id?: string | null;
  } | null;
  const groupColumn = resolveKanbanGroupColumn(cache.columns, config);

  // Pointer sensor with a small activation distance so click-to-rename-like
  // taps don't accidentally start a drag.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  // Status columns available to group by (drives the picker).
  const statusColumns = cache.columns.filter((c) => c.kind === "status");

  // These memos must be unconditional (above the early return) to keep hook
  // order stable. When groupColumn is null, kanbanColumns is an empty array
  // and neither it nor cellMap is rendered.
  const kanbanColumns = useMemo(
    () => (groupColumn ? buildKanbanColumns(cache, groupColumn) : []),
    [cache, groupColumn],
  );

  // Columns surfaced read-only on each card, split into a status/label pill row
  // and a quiet meta footer (date · people · percent · number). The grouping
  // column is excluded — the lane already represents it.
  const cardColumns = useMemo(
    () => selectCardColumns(cache.columns, groupColumn?.id ?? ""),
    [cache.columns, groupColumn?.id],
  );

  const cellMap = useMemo(
    () => buildCellMap(cache.cellValues),
    [cache.cellValues],
  );

  if (!groupColumn) {
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
            Add a Status column to use the Kanban view.
          </p>
        </div>
      </div>
    );
  }

  // Cards land in the first group (No-status); the user drags to set status.
  const firstGroupId = cache.groups[0]?.id;

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || !groupColumn) return;
    const data = active.data.current as CardDragData | undefined;
    if (!data) return;
    const toCol = kanbanColumns.find((c) => c.id === over.id);
    if (!toCol) return;
    onCardDropped(
      data.itemId,
      data.fromColId,
      toCol,
      groupColumn.id,
      setCell,
      clearCellValue,
    );
  }

  function handleGroupColumnChange(columnId: string) {
    void updateBoardView({
      viewId: selectedViewId,
      config: { group_column_id: columnId },
    }).then(() => router.refresh());
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

      {/* Grouping-column picker — native select keeps it dependency-light. */}
      <div className="flex items-center gap-2 border-b px-6 py-2">
        <label
          htmlFor="kanban-group-column"
          className="text-muted-foreground text-xs font-medium"
        >
          Group by
        </label>
        <select
          id="kanban-group-column"
          value={groupColumn.id}
          onChange={(e) => handleGroupColumnChange(e.target.value)}
          className="bg-surface focus-visible:ring-ring rounded-md border px-2 py-1 text-sm focus-visible:ring-2 focus-visible:outline-none"
        >
          {statusColumns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <DndContext
        id={`kanban-${selectedViewId}`}
        sensors={sensors}
        onDragEnd={handleDragEnd}
      >
        <div className="flex flex-1 gap-4 overflow-x-auto p-4">
          {kanbanColumns.map((col) => (
            <KanbanColumnView
              key={col.id}
              column={col}
              cellMap={cellMap}
              cardColumns={cardColumns}
              members={members}
              firstGroupId={firstGroupId}
              groupColumnId={groupColumn.id}
              addItem={addItem}
              setCell={setCell}
            />
          ))}
        </div>
      </DndContext>
    </div>
  );
}

function KanbanColumnView({
  column,
  cellMap,
  cardColumns,
  members,
  firstGroupId,
  groupColumnId,
  addItem,
  setCell,
}: {
  column: KanbanColumn;
  cellMap: Map<string, CacheCellValue["value"]>;
  cardColumns: CardColumns;
  members: EditorMember[];
  firstGroupId: string | undefined;
  groupColumnId: string;
  addItem: (
    vars: { groupId: string; name: string },
    callbacks?: {
      onSuccess?: (item: CacheItem) => void;
      onError?: (err: Error) => void;
    },
  ) => void;
  setCell: SetCell;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });

  // Virtualize the card list so large columns don't render every card to the DOM.
  const scrollRef = useRef<HTMLDivElement>(null);
  // React Compiler safely skips memoizing this component because useVirtualizer
  // returns non-memoizable functions; that fallback is correct here.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: column.cards.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => CARD_HEIGHT,
    overscan: 8,
    // Cards are variable height; measure each so absolutely-positioned slots
    // don't overlap. getBoundingClientRect().height is 0 in jsdom — fall back
    // to the estimate so tests don't collapse every card to 0px.
    measureElement: (el) => el.getBoundingClientRect().height || CARD_HEIGHT,
  });

  return (
    <section
      ref={setNodeRef}
      aria-label={column.label}
      className={cn(
        // Lane is sunken so the raised cards lift off it (the previous
        // surface-muted lane sat lighter than the cards, making them recede).
        "bg-surface-sunken flex w-72 shrink-0 flex-col rounded-lg border",
        isOver && "ring-ring ring-2",
      )}
    >
      {/* Column header — outside the scroll container */}
      <header className="flex items-center gap-2 px-3 py-2.5">
        {column.color ? (
          <span
            className="inline-flex items-center truncate rounded-md px-2 py-0.5 text-xs font-medium"
            style={{
              backgroundColor: column.color,
              color: pillTextColor(column.color),
            }}
          >
            {column.label}
          </span>
        ) : (
          <span className="flex items-center gap-2">
            <span
              className="bg-muted-foreground/60 size-2 shrink-0 rounded-full"
              aria-hidden
            />
            <span className="text-muted-foreground text-xs font-medium">
              {column.label}
            </span>
          </span>
        )}
        <span className="bg-accent text-muted-foreground ml-auto rounded-full px-2 py-0.5 text-xs font-medium tabular-nums">
          {column.cards.length}
        </span>
      </header>

      {/* Virtualized card scroll area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-2">
        {/* Sizer div — sets the total scrollable height for the virtualizer */}
        <div
          className="relative"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualizer.getVirtualItems().map((vc) => {
            const card = column.cards[vc.index];
            return (
              <div
                key={card.id}
                data-index={vc.index}
                ref={virtualizer.measureElement}
                className="absolute top-0 left-0 w-full pb-2"
                style={{ transform: `translateY(${vc.start}px)` }}
              >
                <KanbanCard
                  item={card}
                  fromColId={column.id}
                  cellMap={cellMap}
                  cardColumns={cardColumns}
                  members={members}
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* Quick-add control — outside the scroll container */}
      <AddCardInput
        groupId={firstGroupId}
        columnLabel={column.label}
        optionId={column.optionId}
        groupColumnId={groupColumnId}
        addItem={addItem}
        setCell={setCell}
      />
    </section>
  );
}

function KanbanCard({
  item,
  fromColId,
  cellMap,
  cardColumns,
  members,
}: {
  item: CacheItem;
  fromColId: string;
  cellMap: Map<string, CacheCellValue["value"]>;
  cardColumns: CardColumns;
  members: EditorMember[];
}) {
  const dragData: CardDragData = { itemId: item.id, fromColId };
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: item.id, data: dragData });

  // The in-view presence signal for a Kanban card is "someone is dragging it":
  // two people grabbing the same card is a real collision. Broadcast focus
  // while this card is being dragged; the ring surfaces other users' drags.
  const target = presenceTarget.card(item.id);
  usePresenceFocus({ viewKind: "kanban", targetId: target }, isDragging);

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  // Only fields with a value reach the card — a present cell, never a lonely
  // icon or empty pill reserving space.
  const cellOf = (col: CacheColumn) =>
    (cellMap.get(cellKey(item.id, col.id)) ?? null) as Json;
  const pills = cardColumns.pills.filter(
    (c) => !isCardCellEmpty(c.kind, cellOf(c)),
  );
  const meta = cardColumns.meta.filter(
    (c) => !isCardCellEmpty(c.kind, cellOf(c)),
  );

  return (
    <article
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={cn(
        "bg-surface focus-visible:ring-ring shadow-card relative cursor-grab rounded-lg border p-3 text-left transition-shadow focus-visible:ring-2 focus-visible:outline-none",
        isDragging && "opacity-50",
      )}
    >
      <PresenceRing target={target} />
      <p className="line-clamp-2 text-sm leading-snug font-medium">
        {item.name}
      </p>

      {pills.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {pills.map((col) => (
            <CellRenderer
              key={col.id}
              kind={col.kind}
              value={cellOf(col)}
              settings={(col.settings ?? {}) as Settings}
              members={members}
            />
          ))}
        </div>
      )}

      {meta.length > 0 && (
        <div className="text-muted-foreground mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          {meta.map((col) =>
            col.kind === "percent" ? (
              <span
                key={col.id}
                title={col.name}
                className="flex min-w-[7rem] flex-1 items-center"
              >
                <CellRenderer
                  kind={col.kind}
                  value={cellOf(col)}
                  settings={(col.settings ?? {}) as Settings}
                  members={members}
                />
              </span>
            ) : (
              <span
                key={col.id}
                title={col.name}
                className="inline-flex min-w-0 items-center gap-1.5 text-xs"
              >
                <MetaIcon kind={col.kind} />
                <CellRenderer
                  kind={col.kind}
                  value={cellOf(col)}
                  settings={(col.settings ?? {}) as Settings}
                  members={members}
                />
              </span>
            ),
          )}
        </div>
      )}
    </article>
  );
}

function AddCardInput({
  groupId,
  columnLabel,
  optionId,
  groupColumnId,
  addItem,
  setCell,
}: {
  groupId: string | undefined;
  columnLabel: string;
  /** The status option this column represents; null for the No-status column. */
  optionId: string | null;
  groupColumnId: string;
  addItem: (
    vars: { groupId: string; name: string },
    callbacks?: {
      onSuccess?: (item: CacheItem) => void;
      onError?: (err: Error) => void;
    },
  ) => void;
  setCell: SetCell;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function commit() {
    const trimmed = name.trim();
    if (!trimmed || !groupId) return;
    setError(null);
    startTransition(() => {
      // Quick-add creates the item in the first group, then — for an option
      // column — sets its status to that column's option so the new card lands
      // where the user added it. The No-status column (optionId === null) leaves
      // the status unset.
      addItem(
        { groupId, name: trimmed },
        {
          onSuccess: (item) => {
            if (optionId !== null) {
              setCell({
                itemId: item.id,
                columnId: groupColumnId,
                value: { optionId },
              });
            }
            setName("");
            setError(null);
          },
          onError: (err) => setError(err.message),
        },
      );
    });
  }

  return (
    <div className="px-2 pb-2">
      <div className="flex items-center gap-2 px-1">
        <Plus className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
          }}
          disabled={isPending || !groupId}
          placeholder="Add item"
          aria-label={`Add item to ${columnLabel}`}
          className="text-foreground placeholder:text-muted-foreground focus-visible:ring-ring w-full bg-transparent text-sm outline-none focus-visible:rounded-sm focus-visible:ring-2 disabled:opacity-50"
        />
      </div>
      {error ? (
        <p role="alert" className="text-destructive px-1 text-xs">
          {error}
        </p>
      ) : null}
    </div>
  );
}

// Re-exported for downstream consumers that want the unset-column sentinel.
export { NO_STATUS_ID };
