"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { GripVertical, Users2 } from "lucide-react";
import {
  DndContext,
  MeasuringStrategy,
  useDraggable,
  useDroppable,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
// Aliased: the global `CSS.escape` is needed below, and an unqualified `CSS`
// import would shadow it.
import { CSS as DndCSS } from "@dnd-kit/utilities";
import type { BoardListEntry, SharedBoardEntry } from "@/lib/boards/queries";
import type { BoardFolder } from "@/lib/boards/folders/types";
import { reorderPosition } from "@/lib/boards/group-reorder";
import { reorderBoard } from "@/lib/boards/actions";
import { moveBoardToFolder } from "@/lib/boards/folders/actions";
import { showMutationError } from "@/lib/ui/mutation-toast";
import { useTouchAwareSensors } from "@/lib/dnd/sensors";
import { cn } from "@/lib/utils";
import { BoardItemMenu } from "@/components/boards/BoardItemMenu";
import { BoardFolderRow } from "@/components/boards/BoardFolderRow";
import {
  focusAnchorTarget,
  type BoardsNavFocusAnchor,
} from "@/components/boards/boards-nav-focus";
import { SharedBoardRow } from "@/components/boards/SharedBoardRow";
import { SharedBoardsSection } from "@/components/boards/SharedBoardsSection";

/**
 * One rendered folder in the nav, handed down from `BoardsNav`. The rows inside
 * `children` are built exactly once up there (plain and drag-enabled trees show
 * the same markup); this layer only adds the drop target around them.
 */
export type FolderSection = {
  folder: BoardFolder;
  count: number;
  children: ReactNode;
};

/**
 * The grip column, shared by the owned and shared row variants so the two
 * unfiled lists present one continuous handle column. Hidden until the row is
 * hovered or the handle is focused.
 */
const GRIP_CLASS =
  "text-muted-foreground focus-visible:ring-ring flex size-6 shrink-0 cursor-grab touch-none items-center justify-center rounded opacity-0 transition-opacity group-hover/row:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:outline-none active:cursor-grabbing";

/** Droppable ids are namespaced so a folder can never collide with a board id. */
const FOLDER_DROP_PREFIX = "folder:";

function folderIdFromDropTarget(overId: string): string | null {
  return overId.startsWith(FOLDER_DROP_PREFIX)
    ? overId.slice(FOLDER_DROP_PREFIX.length)
    : null;
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
      data-board-row={board.id}
      style={{ transform: DndCSS.Translate.toString(transform), transition }}
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
        className={GRIP_CLASS}
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
 * A shared board that can be dragged into a folder. It uses `useDraggable`, not
 * `useSortable`: a board someone else owns has no position in MY owned list, so
 * it is a drag SOURCE only. Dropping one on another board is a no-op —
 * `reorderPosition` returns null for an id that isn't in the ordered list.
 *
 * The handle says "Move …", not "Reorder …", because that is all it can do.
 */
function DraggableSharedRow({
  board,
  isActive,
  folders,
}: {
  board: SharedBoardEntry;
  isActive: boolean;
  folders: BoardFolder[];
}) {
  const { setNodeRef, attributes, listeners, transform, isDragging } =
    useDraggable({ id: board.id });

  return (
    <SharedBoardRow
      board={board}
      isActive={isActive}
      folders={folders}
      currentFolderId={null}
      dragRef={setNodeRef}
      isDragging={isDragging}
      style={{ transform: DndCSS.Translate.toString(transform) }}
      leading={
        <button
          type="button"
          aria-label={`Move ${board.name} into a folder`}
          className={GRIP_CLASS}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-3.5" />
        </button>
      }
    />
  );
}

/**
 * A folder header wired up as a drop target. `useDroppable` lives here rather
 * than in `BoardFolderRow` so that component stays @dnd-kit-free and can render
 * in the plain (pre-drag) tree too.
 */
function DroppableFolderRow({ section }: { section: FolderSection }) {
  const { setNodeRef, isOver } = useDroppable({
    id: `${FOLDER_DROP_PREFIX}${section.folder.id}`,
  });

  return (
    <BoardFolderRow
      folder={section.folder}
      count={section.count}
      dropRef={setNodeRef}
      isOver={isOver}
    >
      {section.children}
    </BoardFolderRow>
  );
}

/**
 * The drag-enabled variant of the Boards nav body: folder rows (drop targets),
 * the unfiled owned list (vertically sortable) and the unfiled shared list
 * (drag sources). Holds the entire @dnd-kit
 * stack (~30-40KB gz), so it is a lazy `next/dynamic({ ssr: false })` chunk
 * mounted by `BoardsNav` on first interaction — keeping @dnd-kit out of the
 * shell bundle that loads on every authenticated route.
 *
 * One `DndContext` spans all three regions, because a drag starts in either
 * unfiled list and can end on a folder header. `SortableContext` stays scoped
 * to the unfiled OWNED list: folders are drop targets, not reorderable items,
 * and shared boards have no position of mine to reorder.
 */
export function BoardsNavSortable({
  boards,
  sharedBoards = [],
  folderSections = [],
  activeBoardId,
  folders = [],
  restoreFocus = null,
}: {
  boards: BoardListEntry[];
  sharedBoards?: SharedBoardEntry[];
  folderSections?: FolderSection[];
  activeBoardId?: string;
  folders?: BoardFolder[];
  /**
   * The board row that held focus when `BoardsNav` swapped the plain tree for
   * this one. That swap destroys the focused element, so this variant hands
   * focus back on mount — otherwise a keyboard user's first Tab into the boards
   * list silently drops them on <body>.
   */
  restoreFocus?: BoardsNavFocusAnchor | null;
}) {
  const router = useRouter();

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

  /**
   * Filing a board by dropping it on a folder header. Unlike reorder this
   * genuinely changes what the server renders (the placement decides which
   * subtree the row lives in), so it revalidates — gotcha-44 is about reorder,
   * where the optimistic order is already authoritative.
   */
  function fileIntoFolder(boardId: string, folderId: string) {
    void moveBoardToFolder({ boardId, folderId }).then((res) => {
      if (!res.ok) {
        showMutationError("Couldn't move the board.", new Error(res.error));
        return;
      }
      router.refresh();
    });
  }

  function reorderWithin(activeId: string, overId: string) {
    const position = reorderPosition(
      ordered.map((b) => ({ id: b.id, position: b.position })),
      activeId,
      overId,
    );
    if (position === null) return;
    // Snapshot the pre-drag order so a failed persist can be rolled back —
    // otherwise the new order looks saved until the next reload snaps it back.
    const previousOrder = ordered;
    setOrdered((prev) =>
      prev
        .map((b) => (b.id === activeId ? { ...b, position } : b))
        .sort((a, b) => a.position - b.position),
    );
    void reorderBoard({ boardId: activeId, position }).then((res) => {
      if (!res.ok) {
        setOrdered(previousOrder);
        toast.error("Couldn't reorder the board — your change was undone.", {
          description: res.error,
        });
      }
    });
  }

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;

    const folderId = folderIdFromDropTarget(String(over.id));
    if (folderId) {
      fileIntoFolder(String(active.id), folderId);
      return;
    }
    reorderWithin(String(active.id), String(over.id));
  }

  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!restoreFocus) return;
    // Only step in when the swap actually DROPPED focus. If the user tabbed
    // onward while the lazy chunk loaded, focus is somewhere legitimate and
    // yanking it backwards would be worse than the bug this fixes.
    if (document.activeElement && document.activeElement !== document.body)
      return;
    focusAnchorTarget(containerRef.current, restoreFocus)?.focus();
    // Runs on mount (the prop is already set by the time this list first
    // renders) and never again — a later identical value means the server
    // re-rendered, not that the list was swapped in under the user.
  }, [restoreFocus]);

  return (
    <div
      data-testid="boards-nav-sortable"
      ref={containerRef}
      className="flex flex-col gap-0.5"
    >
      <DndContext
        id="sidebar-boards"
        sensors={sensors}
        // Kept: folder headers sit directly above the unfiled list in the same
        // narrow column, so a vertical-only drag still reaches every drop
        // target — and reorder keeps its tight, rail-aligned feel.
        modifiers={[restrictToVerticalAxis]}
        // dnd-kit's default (MeasuringStrategy.WhileDragging) measures each
        // droppable once at drag start and re-measures only when that droppable
        // itself resizes. Hovering a collapsed folder expands its BODY — a
        // SIBLING of the droppable header — which pushes every row below it
        // down without invalidating a single cached rect, so collision
        // detection would keep hit-testing stale positions. Measure always.
        measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
        onDragEnd={handleDragEnd}
      >
        {folderSections.map((section) => (
          <DroppableFolderRow key={section.folder.id} section={section} />
        ))}
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
        <SharedBoardsSection
          boards={sharedBoards}
          folders={folders}
          activeBoardId={activeBoardId}
          renderRow={(board) => (
            <DraggableSharedRow
              board={board}
              isActive={board.id === activeBoardId}
              folders={folders}
            />
          )}
        />
      </DndContext>
    </div>
  );
}
