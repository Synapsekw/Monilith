"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  useDraggable,
  useDroppable,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { Plus } from "lucide-react";

import { cn } from "@/lib/utils";
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
import { useBoardRealtime } from "@/lib/boards/use-board-realtime";
import { resolveKanbanGroupColumn } from "@/lib/boards/views";
import {
  buildKanbanColumns,
  NO_STATUS_ID,
  type KanbanColumn,
} from "@/lib/boards/kanban";
import { updateBoardView } from "@/lib/boards/view-actions";
import { BoardHeader } from "@/components/boards/BoardHeader";
import { CellRenderer } from "@/components/boards/cells";
import type { EditorMember } from "@/components/boards/cells/editors";

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
}: {
  payload: BoardPayload;
  // Accepted for parity with BoardTable / the route's prop contract. The card
  // People summary is count-only (CellRenderer), so member identities aren't
  // needed here yet — kept in the signature for the shared call shape.
  members?: EditorMember[];
  selectedViewId: string;
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
  useBoardRealtime(payload.board.id);

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

  if (!groupColumn) {
    return (
      <div className="flex h-full flex-col">
        <BoardHeader
          boardId={cache.board.id}
          boardName={cache.board.name}
          views={payload.views}
          selectedViewId={selectedViewId}
        />
        <div className="flex flex-1 items-center justify-center p-8">
          <p className="text-muted-foreground text-sm">
            Add a Status column to use the Kanban view.
          </p>
        </div>
      </div>
    );
  }

  const kanbanColumns = buildKanbanColumns(cache, groupColumn);

  // Cards land in the first group (No-status); the user drags to set status.
  const firstGroupId = cache.groups[0]?.id;

  // People/Date columns surfaced read-only on each card.
  const summaryColumns = cache.columns.filter(
    (c) => c.kind === "people" || c.kind === "date",
  );

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

      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <div className="flex flex-1 gap-4 overflow-x-auto p-4">
          {kanbanColumns.map((col) => (
            <KanbanColumnView
              key={col.id}
              column={col}
              cellValues={cache.cellValues}
              summaryColumns={summaryColumns}
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
  cellValues,
  summaryColumns,
  firstGroupId,
  groupColumnId,
  addItem,
  setCell,
}: {
  column: KanbanColumn;
  cellValues: CacheCellValue[];
  summaryColumns: CacheColumn[];
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

  return (
    <section
      ref={setNodeRef}
      aria-label={column.label}
      className={cn(
        "bg-surface-muted flex w-72 shrink-0 flex-col rounded-md border",
        isOver && "ring-ring ring-2",
      )}
    >
      <header className="flex items-center gap-2 px-3 py-2">
        {column.color ? (
          <span
            className="inline-flex items-center truncate rounded-md px-2 py-0.5 text-xs font-medium text-white"
            style={{ backgroundColor: column.color }}
          >
            {column.label}
          </span>
        ) : (
          <span className="text-muted-foreground text-xs font-medium">
            {column.label}
          </span>
        )}
        <span className="text-muted-foreground text-xs tabular-nums">
          {column.cards.length}
        </span>
      </header>

      <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
        {column.cards.map((card) => (
          <KanbanCard
            key={card.id}
            item={card}
            fromColId={column.id}
            cellValues={cellValues}
            summaryColumns={summaryColumns}
          />
        ))}
      </div>

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
  cellValues,
  summaryColumns,
}: {
  item: CacheItem;
  fromColId: string;
  cellValues: CacheCellValue[];
  summaryColumns: CacheColumn[];
}) {
  const dragData: CardDragData = { itemId: item.id, fromColId };
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: item.id, data: dragData });

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  return (
    <article
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={cn(
        "bg-surface focus-visible:ring-ring cursor-grab rounded-md border p-2.5 text-left shadow-sm transition-shadow focus-visible:ring-2 focus-visible:outline-none",
        isDragging && "opacity-50",
      )}
    >
      <p className="truncate text-sm font-medium">{item.name}</p>
      {summaryColumns.length > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          {summaryColumns.map((col) => {
            const cell = cellValues.find(
              (c) => c.item_id === item.id && c.column_id === col.id,
            );
            const value = (cell?.value ?? null) as Json;
            // No-op for empty cells: CellRenderer renders an empty span.
            return (
              <CellRenderer
                key={col.id}
                kind={col.kind}
                value={value}
                settings={(col.settings ?? {}) as Settings}
              />
            );
          })}
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
