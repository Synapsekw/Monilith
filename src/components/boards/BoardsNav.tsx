"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { Eye, FolderKanban, GripVertical, Users2 } from "lucide-react";
import { DndContext, type DragEndEvent } from "@dnd-kit/core";
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
import { useTouchAwareSensors } from "@/lib/dnd/sensors";
import { useCoarsePointer } from "@/lib/hooks/use-coarse-pointer";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { NewBoardDialog } from "@/components/boards/NewBoardDialog";
import { BoardItemMenu } from "@/components/boards/BoardItemMenu";
import { NavSection } from "@/components/shell/nav-section";

/**
 * Visible caption for a collapsed icon/initial rail item under a coarse pointer.
 * Closes gotcha-47 for the sidebar board list: the touch-suppressed tooltip is
 * no longer an item's only label. Text equals the trigger's `aria-label` (single
 * source) and is `truncate`d so a long board name never widens the `w-14` rail.
 */
function CoarseCaption({ label }: { label: string }) {
  return (
    <span className="text-muted-foreground max-w-full truncate text-[10px] leading-tight normal-case">
      {label}
    </span>
  );
}

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
      />
    </div>
  );
}

export function BoardsNav({
  boards,
  sharedBoards,
  activeWorkspaceId,
  collapsed = false,
}: {
  boards: BoardListEntry[];
  sharedBoards: SharedBoardEntry[];
  activeWorkspaceId?: string;
  collapsed?: boolean;
}) {
  const { boardId: activeBoardId } = useParams<{ boardId: string }>();
  const coarse = useCoarsePointer();

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

  return collapsed ? (
    <div className="flex flex-col items-center gap-0.5 px-2 py-2">
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            aria-label="Boards"
            className="text-muted-foreground flex size-9 max-w-full flex-col items-center justify-center gap-0.5 pointer-coarse:size-auto pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:px-1 pointer-coarse:py-1.5"
          >
            <FolderKanban className="size-4 shrink-0" />
            {coarse ? <CoarseCaption label="Boards" /> : null}
          </span>
        </TooltipTrigger>
        <TooltipContent side="right">Boards</TooltipContent>
      </Tooltip>
      {/* Triggerless: keeps the dialog mounted so the ⌘K "New board"
          command can open it even while the sidebar is collapsed. */}
      <NewBoardDialog workspaceId={activeWorkspaceId} collapsed />

      {boards.length === 0
        ? null
        : boards.map((b) => (
            <Tooltip key={b.id}>
              <TooltipTrigger asChild>
                <Link
                  href={`/boards/${b.id}`}
                  aria-current={b.id === activeBoardId ? "page" : undefined}
                  aria-label={b.name}
                  className={cn(
                    "flex size-9 max-w-full flex-col items-center justify-center rounded-md text-sm font-medium uppercase transition-colors pointer-coarse:size-auto pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:gap-0.5 pointer-coarse:px-1 pointer-coarse:py-1.5",
                    b.id === activeBoardId
                      ? "bg-primary/80 text-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  <span className="shrink-0">{b.name.charAt(0)}</span>
                  {coarse ? <CoarseCaption label={b.name} /> : null}
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right">{b.name}</TooltipContent>
            </Tooltip>
          ))}

      {/* Shared with me */}
      {sharedBoards.length > 0
        ? sharedBoards.map((b) => (
            <Tooltip key={b.id}>
              <TooltipTrigger asChild>
                <Link
                  href={`/boards/${b.id}`}
                  aria-current={b.id === activeBoardId ? "page" : undefined}
                  aria-label={b.name}
                  className={cn(
                    "flex size-9 max-w-full flex-col items-center justify-center rounded-md text-sm font-medium uppercase transition-colors pointer-coarse:size-auto pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:gap-0.5 pointer-coarse:px-1 pointer-coarse:py-1.5",
                    b.id === activeBoardId
                      ? "bg-primary/80 text-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  <span className="shrink-0">{b.name.charAt(0)}</span>
                  {coarse ? <CoarseCaption label={b.name} /> : null}
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right">{b.name}</TooltipContent>
            </Tooltip>
          ))
        : null}
    </div>
  ) : (
    <NavSection
      storageKey="boards"
      title="Boards"
      icon={FolderKanban}
      action={<NewBoardDialog workspaceId={activeWorkspaceId} />}
    >
      {boards.length === 0 ? (
        <p className="text-muted-foreground px-3 py-1 text-xs">No boards yet</p>
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
      {sharedBoards.length > 0 ? (
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
                "flex items-center gap-1 rounded-md px-3 py-1 text-xs transition-colors",
                b.id === activeBoardId
                  ? "bg-primary/80 text-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <span className="min-w-0 flex-1 truncate">{b.name}</span>
              {b.access_level === "viewer" ? (
                <Eye
                  aria-label="View only"
                  className="text-muted-foreground size-3 shrink-0"
                />
              ) : null}
              {/* Who shared it: an icon with a hover tooltip, replacing the
                  redundant "· from {owner}" second line. */}
              {b.owner_name ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="flex shrink-0 items-center">
                      <Users2
                        aria-label={`Shared by ${b.owner_name}`}
                        className="text-muted-foreground size-3.5"
                      />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="right">
                    Shared by {b.owner_name}
                  </TooltipContent>
                </Tooltip>
              ) : null}
            </Link>
          ))}
        </>
      ) : null}
    </NavSection>
  );
}
