"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
// Aliased: the global `CSS.escape` is needed below, and an unqualified `CSS`
// import would shadow it.
import { CSS as DndCSS } from "@dnd-kit/utilities";
import type { BoardListEntry, SharedBoardEntry } from "@/lib/boards/queries";
import type { BoardFolder } from "@/lib/boards/folders/types";
import type { NavBoard } from "@/lib/boards/folders/group";
import { reorderPosition } from "@/lib/boards/group-reorder";
import { navSyncKey } from "@/lib/boards/nav-sync-key";
import { reorderBoard } from "@/lib/boards/actions";
import { moveBoardToFolder } from "@/lib/boards/folders/actions";
import { showMutationError } from "@/lib/ui/mutation-toast";
import { useTouchAwareSensors } from "@/lib/dnd/sensors";
import { useUIStore } from "@/stores/ui";
import { cn } from "@/lib/utils";
import { BoardItemMenu } from "@/components/boards/BoardItemMenu";
import { BoardFolderRow } from "@/components/boards/BoardFolderRow";
// A filed OWNED row is the same component the plain tree renders, just handed a
// real grip instead of the inert spacer — which is what keeps the two trees
// pixel-identical (the "folder row alignment" tests).
import { PlainBoardRow } from "@/components/boards/PlainBoardRow";
import {
  focusAnchorTarget,
  type BoardsNavFocusAnchor,
} from "@/components/boards/boards-nav-focus";
import { SharedBoardRow } from "@/components/boards/SharedBoardRow";
import { SharedBoardsSection } from "@/components/boards/SharedBoardsSection";

/**
 * One folder in the nav, handed down from `BoardsNav` as DATA rather than as
 * finished markup. The two trees render the same entries differently — the
 * plain one with inert rows, this one with real grip handles — so the rows
 * cannot be built once upstream. The count derives from `entries.length`; there
 * is no separate field to fall out of step with the list.
 */
export type FolderSection = {
  folder: BoardFolder;
  entries: NavBoard[];
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
 * A drag SOURCE that is not a `useSortable` item — a shared board, or any board
 * already filed in a folder. Neither has a position in MY owned list to persist,
 * so neither is sortable; both can still be picked up and dropped on a folder.
 *
 * ## Why the droppable is not optional
 *
 * `useSortable` registers a draggable AND a droppable under the same id.
 * `sortableKeyboardCoordinates` depends on that: it ends with
 *
 *     const activeDroppable = droppableContainers.get(active.id);
 *     if (newNode && newRect && activeDroppable && newDroppable) { … }
 *     return undefined;
 *
 * (verified in @dnd-kit/sortable@10.0.0, sortable.cjs.development.js:738-745).
 * A row that registers only a draggable therefore picks up on Space and then
 * returns `undefined` for every arrow press — it lifts and refuses to move,
 * which is a worse lie than having no keyboard drag at all. So every non-
 * sortable drag source pairs a `useDroppable` on the SAME node and id.
 *
 * Landing a drop on such an id is already an explicit no-op:
 * `folderIdFromDropTarget` returns null, and `reorderPosition` returns null
 * because the id is not in `ordered`.
 */
function useDragSource(id: string, data?: { folderId: string }) {
  const {
    setNodeRef: setDragRef,
    attributes,
    listeners,
    transform,
    isDragging,
  } = useDraggable({ id, data });
  const { setNodeRef: setDropRef } = useDroppable({ id });

  // Both refs, one node. `useCallback` so the identity is stable — dnd-kit
  // treats a new ref callback as a node change and re-measures.
  const setNodeRef = useCallback(
    (node: HTMLElement | null) => {
      setDragRef(node);
      setDropRef(node);
    },
    [setDragRef, setDropRef],
  );

  return { setNodeRef, attributes, listeners, transform, isDragging };
}

/** The grip button itself — identical for every non-sortable drag source. */
function DragSourceGrip({
  label,
  attributes,
  listeners,
}: {
  label: string;
  // dnd-kit's own types, not a hand-written `Record<string, unknown>` — same
  // `ReturnType<typeof …>` idiom `table/GroupHeaderRow.tsx` already uses.
  attributes: ReturnType<typeof useDraggable>["attributes"];
  listeners: ReturnType<typeof useDraggable>["listeners"];
}) {
  return (
    <button
      type="button"
      aria-label={label}
      className={GRIP_CLASS}
      {...attributes}
      {...listeners}
    >
      <GripVertical className="size-3.5" />
    </button>
  );
}

/**
 * An unfiled shared board. The handle says "Move …", not "Reorder …", because
 * that is all it can do.
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
    useDragSource(board.id);

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
        <DragSourceGrip
          label={`Move ${board.name} into a folder`}
          attributes={attributes}
          listeners={listeners}
        />
      }
    />
  );
}

/**
 * A board that is already IN a folder, made draggable so it can be moved
 * straight into another one.
 *
 * The label is "Move X to another folder", not "Reorder X": a folder's boards
 * sort by placement position and no gesture persists that order, so a filed row
 * genuinely cannot reorder. Reusing the unfiled row's label would be a fresh
 * accessibility lie in a slice that exists to remove them.
 */
function DraggableFiledRow({
  entry,
  folderId,
  isActive,
  folders,
}: {
  entry: NavBoard;
  folderId: string;
  isActive: boolean;
  folders: BoardFolder[];
}) {
  const { setNodeRef, attributes, listeners, transform, isDragging } =
    // The folder travels with the drag so `handleDragEnd` can reject a drop
    // back onto the folder the board is already in.
    useDragSource(entry.board.id, { folderId });

  const shared = {
    isActive,
    folders,
    currentFolderId: folderId,
    dragRef: setNodeRef,
    isDragging,
    style: { transform: DndCSS.Translate.toString(transform) },
    leading: (
      <DragSourceGrip
        label={`Move ${entry.board.name} to another folder`}
        attributes={attributes}
        listeners={listeners}
      />
    ),
  };

  return entry.kind === "owned" ? (
    <PlainBoardRow board={entry.board} {...shared} />
  ) : (
    <SharedBoardRow board={entry.board} {...shared} />
  );
}

/**
 * A folder header wired up as a drop target. `useDroppable` lives here rather
 * than in `BoardFolderRow` so that component stays @dnd-kit-free and can render
 * in the plain (pre-drag) tree too.
 */
function DroppableFolderRow({
  section,
  activeBoardId,
  folders,
}: {
  section: FolderSection;
  activeBoardId?: string;
  folders: BoardFolder[];
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `${FOLDER_DROP_PREFIX}${section.folder.id}`,
  });

  return (
    <BoardFolderRow
      folder={section.folder}
      count={section.entries.length}
      dropRef={setNodeRef}
      isOver={isOver}
    >
      {section.entries.map((entry) => (
        <DraggableFiledRow
          key={entry.board.id}
          entry={entry}
          folderId={section.folder.id}
          isActive={entry.board.id === activeBoardId}
          folders={folders}
        />
      ))}
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
  // Selector, as the rest of the tree does — subscribing to the whole store
  // would re-render this list on every unrelated UI-state change.
  const setSection = useUIStore((s) => s.setSection);

  // Optimistic order for the owned list: seeded from server props, re-synced
  // (during render, per React's "adjust state when a prop changes" pattern)
  // whenever the server sends a new list — e.g. after a create/rename/delete
  // revalidates the shell. Reorder itself is NOT revalidated (that would reload
  // the whole sidebar, gotcha-44); the optimistic order here is authoritative
  // and the new position is persisted, so a fresh load reads it back.
  //
  // The comparison is on CONTENT, not identity. Identity was never a safe proxy
  // for "the server sent a new list": the prop is a derived array, so it is
  // re-allocated by any caller that filters or maps on the way down, and a
  // single `boards.filter(...)` upstream would silently snap a just-dragged
  // board back to the stale server order — with the whole suite green. The
  // invariant now lives in `navSyncKey`, where it is testable, instead of in
  // every caller's memoisation.
  const [ordered, setOrdered] = useState(boards);
  const [syncedKey, setSyncedKey] = useState(() => navSyncKey(boards));
  //
  // Memoised on the prop's identity: this component re-renders on every
  // pointermove while a drag is in flight, and `MY_BOARDS_LIMIT` is 500, so an
  // unmemoised scan of the whole list ran on each of those frames. Keying the
  // MEMO on identity does not re-introduce the identity bug the key exists to
  // fix — a miss only costs a recompute that yields the same string, and a
  // genuine content change always arrives as a fresh array (props from the
  // server are never mutated in place), so a real change can never be missed.
  const incomingKey = useMemo(() => navSyncKey(boards), [boards]);
  if (syncedKey !== incomingKey) {
    setSyncedKey(incomingKey);
    setOrdered(boards);
  }

  // Shared sensors: 6px move for mouse, 200ms long-press lift for touch (a quick
  // swipe scrolls the list instead of grabbing a board) — plus, for this surface
  // only, a KeyboardSensor. dnd-kit announces a space-bar lift on every handle;
  // without this the announcement was false. `sortableKeyboardCoordinates` is
  // the right strategy here because everything in this context is a vertical
  // list of rows and folder headers, and it walks EVERY droppable in the
  // context (not just the SortableContext's items), so folder headers are
  // arrow-key reachable too. Both imports live only in this lazy chunk, which
  // already carries the dnd stack. See decision-41 for the surfaces that stay
  // opted out.
  const sensors = useTouchAwareSensors({
    keyboardCoordinateGetter: sortableKeyboardCoordinates,
  });

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
      // The folder may have been collapsed — and hover-expansion is purely
      // visual now, so it will snap shut the instant the pointer leaves, hiding
      // the board the user just filed. `setSection`, never `toggleSection`: an
      // already-open folder must stay open. Client state only, 0 round-trips.
      setSection(`${FOLDER_DROP_PREFIX}${folderId}`, false);
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
      // Dropping a board back on its OWN folder header is a no-op, not a write.
      // `active.id === over.id` never catches it — the ids are namespaced
      // differently — and without this guard it fires a pointless server write
      // plus a full router.refresh().
      if (active.data.current?.folderId === folderId) return;
      fileIntoFolder(String(active.id), folderId);
      return;
    }
    // Anything else — including a filed row dropped on an unfiled board — falls
    // through to reorder, where `reorderPosition` returns null for an id that is
    // not in `ordered`. That is the "snaps back, no write, no toast" path:
    // dragging a board OUT of a folder is the ⋯ menu's job, not a gesture.
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
          <DroppableFolderRow
            key={section.folder.id}
            section={section}
            activeBoardId={activeBoardId}
            folders={folders}
          />
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
