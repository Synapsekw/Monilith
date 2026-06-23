"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Eye, FolderKanban, GripVertical, Users2 } from "lucide-react";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { CSS } from "@dnd-kit/utilities";
import type { BoardListEntry, SharedBoardEntry } from "@/lib/boards/queries";
import { reorderPosition } from "@/lib/boards/group-reorder";
import { reorderBoard } from "@/lib/boards/actions";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { NewBoardDialog } from "@/components/boards/NewBoardDialog";
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
}: {
  board: BoardListEntry;
  isActive: boolean;
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
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
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
        className="flex min-w-0 flex-1 items-center gap-1.5 py-1 pr-1 text-xs"
      >
        <span className="truncate">{board.name}</span>
        {board.shared_out ? (
          <Users2
            aria-label="Shared with others"
            className="text-muted-foreground size-3.5 shrink-0"
          />
        ) : null}
      </Link>
      <BoardItemMenu
        board={{ id: board.id, name: board.name }}
        isActive={isActive}
      />
    </div>
  );
}

export function BoardsNav({
  boards,
  sharedBoards,
  workspaces,
  collapsed = false,
}: {
  boards: BoardListEntry[];
  sharedBoards: SharedBoardEntry[];
  workspaces: { id: string; name: string }[];
  collapsed?: boolean;
}) {
  const { boardId: activeBoardId } = useParams<{ boardId: string }>();

  // Optimistic order for the owned list: seeded from server props, re-synced
  // (during render, per React's "adjust state when a prop changes" pattern)
  // whenever the server sends a new ordering after a reorder revalidates. The
  // prop identity only changes on a server re-render, so a client-only re-render
  // (e.g. our own optimistic setState) does not clobber the optimistic order.
  const [ordered, setOrdered] = useState(boards);
  const [syncedBoards, setSyncedBoards] = useState(boards);
  if (syncedBoards !== boards) {
    setSyncedBoards(boards);
    setOrdered(boards);
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const position = reorderPosition(
      ordered.map((b) => ({ id: b.id, position: b.position })),
      String(active.id),
      String(over.id),
    );
    if (position === null) return;
    setOrdered((prev) =>
      prev
        .map((b) => (b.id === active.id ? { ...b, position } : b))
        .sort((a, b) => a.position - b.position),
    );
    void reorderBoard({ boardId: String(active.id), position });
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-0.5 py-2",
        collapsed ? "items-center px-2" : "px-2",
      )}
    >
      {collapsed ? (
        <>
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                aria-label="Boards"
                className="text-muted-foreground flex size-9 items-center justify-center"
              >
                <FolderKanban className="size-4" />
              </span>
            </TooltipTrigger>
            <TooltipContent side="right">Boards</TooltipContent>
          </Tooltip>
          {/* Triggerless: keeps the dialog mounted so the ⌘K "New board"
              command can open it even while the sidebar is collapsed. */}
          <NewBoardDialog workspaceId={workspaces[0]?.id} collapsed />
        </>
      ) : (
        <div className="flex items-center justify-between px-3 py-1">
          <span className="text-muted-foreground flex items-center gap-2 text-xs font-medium">
            <FolderKanban className="size-4" />
            Boards
          </span>
          <NewBoardDialog workspaceId={workspaces[0]?.id} />
        </div>
      )}

      {boards.length === 0 ? (
        collapsed ? null : (
          <p className="text-muted-foreground px-3 py-1 text-xs">
            No boards yet
          </p>
        )
      ) : collapsed ? (
        boards.map((b) => (
          <Tooltip key={b.id}>
            <TooltipTrigger asChild>
              <Link
                href={`/boards/${b.id}`}
                aria-current={b.id === activeBoardId ? "page" : undefined}
                aria-label={b.name}
                className={cn(
                  "flex size-9 items-center justify-center rounded-md text-sm font-medium uppercase transition-colors",
                  b.id === activeBoardId
                    ? "bg-primary/80 text-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                {b.name.charAt(0)}
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right">{b.name}</TooltipContent>
          </Tooltip>
        ))
      ) : (
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
              />
            ))}
          </SortableContext>
        </DndContext>
      )}

      {/* Shared with me */}
      {sharedBoards.length > 0 ? (
        collapsed ? (
          sharedBoards.map((b) => (
            <Tooltip key={b.id}>
              <TooltipTrigger asChild>
                <Link
                  href={`/boards/${b.id}`}
                  aria-current={b.id === activeBoardId ? "page" : undefined}
                  aria-label={b.name}
                  className={cn(
                    "flex size-9 items-center justify-center rounded-md text-sm font-medium uppercase transition-colors",
                    b.id === activeBoardId
                      ? "bg-primary/80 text-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  {b.name.charAt(0)}
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right">{b.name}</TooltipContent>
            </Tooltip>
          ))
        ) : (
          <>
            <p className="text-muted-foreground px-3 pt-3 text-xs font-medium">
              Shared with me
            </p>
            {sharedBoards.map((b) => (
              <Link
                key={b.id}
                href={`/boards/${b.id}`}
                aria-current={b.id === activeBoardId ? "page" : undefined}
                className={cn(
                  "flex flex-col rounded-md px-3 py-1 text-xs transition-colors",
                  b.id === activeBoardId
                    ? "bg-primary/80 text-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <span className="flex items-center gap-1">
                  <span className="truncate">{b.name}</span>
                  {b.access_level === "viewer" ? (
                    <Eye
                      aria-label="View only"
                      className="text-muted-foreground size-3 shrink-0"
                    />
                  ) : null}
                </span>
                {b.owner_name ? (
                  <span className="text-muted-foreground truncate text-xs">
                    · from {b.owner_name}
                  </span>
                ) : null}
              </Link>
            ))}
          </>
        )
      ) : null}
    </div>
  );
}
