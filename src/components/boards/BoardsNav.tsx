"use client";

import { startTransition, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams } from "next/navigation";
import { FolderKanban, Users2 } from "lucide-react";
import type { BoardListEntry, SharedBoardEntry } from "@/lib/boards/queries";
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
import type {
  BoardFolder,
  BoardFolderPlacement,
} from "@/lib/boards/folders/types";
import { groupBoardsByFolder } from "@/lib/boards/folders/group";
import { BoardFolderRow } from "@/components/boards/BoardFolderRow";
import { NewFolderDialog } from "@/components/boards/NewFolderDialog";
import { SharedBoardRow } from "@/components/boards/SharedBoardRow";
import { SharedBoardsSection } from "@/components/boards/SharedBoardsSection";
// Type-only: erased at compile time, so naming the lazy module here does NOT
// pull @dnd-kit into the shell bundle.
import type { FolderSection } from "@/components/boards/BoardsNavSortable";
import {
  focusAnchorFrom,
  type BoardsNavFocusAnchor,
} from "@/components/boards/boards-nav-focus";

// Keep the @dnd-kit stack (~30-40KB gz) out of the shell bundle that mounts on
// every authenticated route: the drag-to-reorder variant is a lazy client chunk
// mounted only when the owned-boards list is actually interacted with. ssr:false
// is fine — reorder is a pointer/keyboard-only affordance with no SSR value.
const BoardsNavSortable = dynamic(
  () => import("./BoardsNavSortable").then((m) => m.BoardsNavSortable),
  { ssr: false },
);

// Module-level empty defaults, NOT inline `= []`. An inline default allocates a
// fresh array on every render, which would make the `useMemo` below miss on
// every render for any caller that omits these props.
//
// This used to be load-bearing for CORRECTNESS: `BoardsNavSortable`'s optimistic
// reorder re-synced on the `boards` prop's identity, so a missed memo silently
// undid a drag. That sync is content-based now (`navSyncKey`), so these are a
// render-cost saving and nothing more — worth keeping, not worth defending.
//
// `NO_FOLDERS` carries one further meaning that IS load-bearing: it is the
// sentinel for "the caller supplied no folder data at all", which the prune
// effect below must treat as UNKNOWN rather than as "this user has no folders".
const NO_FOLDERS: BoardFolder[] = [];
const NO_PLACEMENTS: BoardFolderPlacement[] = [];

/**
 * Visible caption for a collapsed icon/initial rail item under a coarse pointer.
 * Closes gotcha-47 for the sidebar board list: the touch-suppressed tooltip is
 * no longer an item's only label. Text equals the trigger's `aria-label` (single
 * source) and is `truncate`d so a long board name never widens the `w-14` rail.
 */
function CoarseCaption({ label }: { label: string }) {
  return (
    <span className="text-muted-foreground text-3xs max-w-full truncate leading-tight normal-case">
      {label}
    </span>
  );
}

/**
 * A non-draggable owned-board row: the default first-paint markup before the
 * lazy sortable variant mounts. Mirrors `SortableBoardRow` minus the grip
 * hooks — an inert `size-6` spacer holds the grip's slot so swapping in the
 * drag-enabled variant on hover doesn't shift the row horizontally.
 */
export function PlainBoardRow({
  board,
  isActive,
  folders = [],
  currentFolderId = null,
}: {
  board: BoardListEntry;
  isActive: boolean;
  folders?: BoardFolder[];
  currentFolderId?: string | null;
}) {
  return (
    <div
      data-board-row={board.id}
      className={cn(
        "group/row flex items-center rounded-md pr-1 transition-colors",
        isActive
          ? "bg-primary/80 text-foreground"
          : "text-muted-foreground hover:bg-state-hover hover:text-foreground",
      )}
    >
      <span className="size-6 shrink-0" aria-hidden />
      <Link
        href={`/boards/${board.id}`}
        aria-current={isActive ? "page" : undefined}
        className="min-w-0 flex-1 truncate py-1 pr-1 text-xs"
      >
        {board.name}
      </Link>
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
        currentFolderId={currentFolderId}
      />
    </div>
  );
}

export function BoardsNav({
  boards,
  sharedBoards,
  folders = NO_FOLDERS,
  placements = NO_PLACEMENTS,
  activeWorkspaceId,
  collapsed = false,
}: {
  boards: BoardListEntry[];
  sharedBoards: SharedBoardEntry[];
  folders?: BoardFolder[];
  placements?: BoardFolderPlacement[];
  activeWorkspaceId?: string;
  collapsed?: boolean;
}) {
  const { boardId: activeBoardId } = useParams<{ boardId: string }>();
  const coarse = useCoarsePointer();

  // Swap the plain list for the drag-enabled variant on the first pointer or
  // keyboard interaction over the owned-boards region. This mounts the lazy
  // @dnd-kit chunk before any dragstart (a grab begins with pointerenter →
  // pointerdown, and dnd-kit needs its 6px activation distance first anyway),
  // so the very first reorder still works — while first paint stays plain and
  // @dnd-kit stays off the shell's initial JS.
  const [dndReady, setDndReady] = useState(false);

  // Mounting the drag layer REPLACES this subtree in the DOM, so the element
  // the user just tabbed to is destroyed and focus falls to <body> — their
  // first Tab into the list appears to do nothing. Remember which row held
  // focus at arm time, and which end of it, so the drag-enabled tree can hand
  // focus back to the same place.
  const [restoreFocus, setRestoreFocus] = useState<BoardsNavFocusAnchor | null>(
    null,
  );

  function armDnd(focusTarget?: Element | null) {
    // Board rows AND folder headers both carry an anchor — every focusable
    // thing in this region belongs to one of them.
    if (focusTarget) setRestoreFocus(focusAnchorFrom(focusTarget));
    // A transition lets React hold the current rows while the lazy chunk
    // resolves rather than flashing the dynamic import's empty fallback. It
    // does NOT save focus on its own — the swap still unmounts the focused
    // node, which is what `restoreFocus` above is for. (jsdom resolves the
    // import inside the same flush, so the flash itself has no unit test.)
    startTransition(() => setDndReady(true));
  }

  // Fold folders + placements into the tree once. `groupBoardsByFolder` owns the
  // "a folder with no visible board is dropped, not rendered empty" rule.
  //
  // The memo is a render-cost saving: the fold allocates several arrays and maps
  // and runs on every client re-render (e.g. `useParams()` changing as you click
  // another board) without it. It is NOT what keeps a just-dragged board in
  // place any more — `BoardsNavSortable` compares the list's CONTENT now, so a
  // missed memo costs work, not correctness.
  const grouped = useMemo(
    () =>
      groupBoardsByFolder({
        folders,
        placements,
        boards,
        sharedBoards,
      }),
    [folders, placements, boards, sharedBoards],
  );

  // Folder rows are defined ONCE here and handed to whichever tree is mounted:
  // the plain one, or the lazy drag layer that wraps each header in a drop
  // target. Both must show identical markup, so neither owns the rows.
  const folderSections: FolderSection[] = grouped.folders.map(
    ({ folder, boards: folderBoards }) => ({
      folder,
      count: folderBoards.length,
      children: folderBoards.map((entry) =>
        entry.kind === "owned" ? (
          <PlainBoardRow
            key={entry.board.id}
            board={entry.board}
            isActive={entry.board.id === activeBoardId}
            folders={folders}
            currentFolderId={folder.id}
          />
        ) : (
          <SharedBoardRow
            key={entry.board.id}
            board={entry.board}
            isActive={entry.board.id === activeBoardId}
            folders={folders}
            currentFolderId={folder.id}
          />
        ),
      ),
    }),
  );

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
                      : "text-muted-foreground hover:bg-state-hover hover:text-foreground",
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
                      : "text-muted-foreground hover:bg-state-hover hover:text-foreground",
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
      action={
        <>
          <NewFolderDialog />
          <NewBoardDialog workspaceId={activeWorkspaceId} />
        </>
      }
    >
      {grouped.unfiledOwned.length === 0 &&
      folderSections.length === 0 &&
      grouped.unfiledShared.length === 0 ? (
        <p className="text-muted-foreground px-3 py-1 text-xs">No boards yet</p>
      ) : dndReady ? (
        <BoardsNavSortable
          boards={grouped.unfiledOwned}
          sharedBoards={grouped.unfiledShared}
          folderSections={folderSections}
          activeBoardId={activeBoardId}
          folders={folders}
          restoreFocus={restoreFocus}
        />
      ) : (
        // Everything that can be dragged, or dragged onto, lives in here — so
        // this is also the region that arms the lazy drag layer.
        <div
          data-testid="boards-nav-body"
          className="flex flex-col gap-0.5"
          onPointerEnter={() => armDnd()}
          // React routes portal events up the COMPONENT tree, so focus landing
          // inside a row's portaled dropdown would otherwise read as "focus
          // entered the board list" and swap this subtree for the lazy sortable
          // one — tearing down the row and closing the menu the user just
          // opened. Only a focus on a real DOM descendant is a genuine
          // interaction with the list.
          onFocus={(e) => {
            if (e.currentTarget.contains(e.target)) armDnd(e.target);
          }}
        >
          {folderSections.map((section) => (
            <BoardFolderRow
              key={section.folder.id}
              folder={section.folder}
              count={section.count}
            >
              {section.children}
            </BoardFolderRow>
          ))}
          {grouped.unfiledOwned.map((b) => (
            <PlainBoardRow
              key={b.id}
              board={b}
              isActive={b.id === activeBoardId}
              folders={folders}
              currentFolderId={null}
            />
          ))}
          <SharedBoardsSection
            boards={grouped.unfiledShared}
            folders={folders}
            activeBoardId={activeBoardId}
          />
        </div>
      )}
    </NavSection>
  );
}
