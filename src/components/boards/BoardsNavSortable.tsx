"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { GripVertical, Users2 } from "lucide-react";
import { DndContext, type DragEndEvent } from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { CSS } from "@dnd-kit/utilities";
import type { BoardListEntry } from "@/lib/boards/queries";
import type { BoardFolder } from "@/lib/boards/folders/types";
import { reorderPosition } from "@/lib/boards/group-reorder";
import { reorderBoard } from "@/lib/boards/actions";
import { useTouchAwareSensors } from "@/lib/dnd/sensors";
import { cn } from "@/lib/utils";
import { BoardItemMenu } from "@/components/boards/BoardItemMenu";

/**
 * A draggable row in the owned-boards list. The board name stays a plain `<Link>`
 * so a click still navigates; only the grip handle starts a drag. The handle's
 * pointer sensor also has a 6px activation distance, so an accidental nudge
 * doesn't reorder.
 */
function SortableBoardRow({
  board,
  isActive,
  folders,
}: {
  board: BoardListEntry;
  isActive: boolean;
  folders: BoardFolder[];
}) {
  const {
    setNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: board.id });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        "group/row flex items-center rounded-md pr-1 transition-colors",
        isDragging && "relative z-20 shadow-lg",
        isActive
          ? "bg-primary/80 text-foreground"
          : "text-muted-foreground hover:bg-state-hover hover:text-foreground",
      )}
    >
      <button
        type="button"
        aria-label={`Reorder ${board.name}`}
        className="text-muted-foreground focus-visible:ring-ring flex size-6 shrink-0 cursor-grab touch-none items-center justify-center rounded opacity-0 transition-opacity group-hover/row:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:outline-none active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-3.5" />
      </button>
      <Link
        href={`/boards/${board.id}`}
        aria-current={isActive ? "page" : undefined}
        className="min-w-0 flex-1 truncate py-1 pr-1 text-xs"
      >
        {board.name}
      </Link>
      {/* Right-aligned share marker — lives outside the name link so it lines
          up in a vertical column under the + (not after the variable-width
          name), just inside the hover actions menu. */}
      {board.shared_out ? (
        <Users2
          aria-label="Shared with others"
          className="text-muted-foreground mr-0.5 size-3.5 shrink-0"
        />
      ) : null}
      <BoardItemMenu
        board={{ id: board.id, name: board.name }}
        isActive={isActive}
        folders={folders}
        // Only unfiled boards reach the sortable list — filed ones render
        // inside their folder, which is not drag-reorderable.
        currentFolderId={null}
      />
    </div>
  );
}

/**
 * The drag-to-reorder variant of the owned-boards list. Holds the entire
 * @dnd-kit stack (~30-40KB gz), so it is a lazy `next/dynamic({ ssr: false })`
 * chunk mounted by `BoardsNav` on first interaction — keeping @dnd-kit out of
 * the shell bundle that loads on every authenticated route.
 */
export function BoardsNavSortable({
  boards,
  activeBoardId,
  folders = [],
  restoreFocusHref = null,
}: {
  boards: BoardListEntry[];
  activeBoardId?: string;
  folders?: BoardFolder[];
  /**
   * The `href` of the board link that held focus when `BoardsNav` swapped the
   * plain list for this one. That swap destroys the focused element, so this
   * variant hands focus back to the same board on mount — otherwise a keyboard
   * user's first Tab into the boards list silently drops them on <body>.
   */
  restoreFocusHref?: string | null;
}) {
  // Optimistic order for the owned list: seeded from server props, re-synced
  // (during render, per React's "adjust state when a prop changes" pattern)
  // whenever the server sends a new list — e.g. after a create/rename/delete
  // revalidates the shell. Reorder itself is NOT revalidated (that would reload
  // the whole sidebar, gotcha-44); the optimistic order here is authoritative
  // and the new position is persisted, so a fresh load reads it back. The prop
  // identity only changes on a server re-render, so a client-only re-render
  // (e.g. our own optimistic setState) does not clobber the optimistic order.
  const [ordered, setOrdered] = useState(boards);
  const [syncedBoards, setSyncedBoards] = useState(boards);
  if (syncedBoards !== boards) {
    setSyncedBoards(boards);
    setOrdered(boards);
  }

  // Shared sensors: 6px move for mouse, 200ms long-press lift for touch (a quick
  // swipe scrolls the list instead of grabbing a board).
  const sensors = useTouchAwareSensors();

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const position = reorderPosition(
      ordered.map((b) => ({ id: b.id, position: b.position })),
      String(active.id),
      String(over.id),
    );
    if (position === null) return;
    // Snapshot the pre-drag order so a failed persist can be rolled back —
    // otherwise the new order looks saved until the next reload snaps it back.
    const previousOrder = ordered;
    setOrdered((prev) =>
      prev
        .map((b) => (b.id === active.id ? { ...b, position } : b))
        .sort((a, b) => a.position - b.position),
    );
    void reorderBoard({ boardId: String(active.id), position }).then((res) => {
      if (!res.ok) {
        setOrdered(previousOrder);
        toast.error("Couldn't reorder the board — your change was undone.", {
          description: res.error,
        });
      }
    });
  }

  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!restoreFocusHref) return;
    containerRef.current
      ?.querySelector<HTMLElement>(`a[href="${restoreFocusHref}"]`)
      ?.focus();
    // Runs on mount (the prop is already set by the time this list first
    // renders) and never again — a later identical value means the server
    // re-rendered, not that the list was swapped in under the user.
  }, [restoreFocusHref]);

  return (
    <div data-testid="boards-nav-sortable" ref={containerRef}>
      <DndContext
        id="sidebar-boards"
        sensors={sensors}
        modifiers={[restrictToVerticalAxis]}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={ordered.map((b) => b.id)}
          strategy={verticalListSortingStrategy}
        >
          {ordered.map((b) => (
            <SortableBoardRow
              key={b.id}
              board={b}
              isActive={b.id === activeBoardId}
              folders={folders}
            />
          ))}
        </SortableContext>
      </DndContext>
    </div>
  );
}
