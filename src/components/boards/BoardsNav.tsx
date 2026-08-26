"use client";

import { useState } from "react";
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

// Keep the @dnd-kit stack (~30-40KB gz) out of the shell bundle that mounts on
// every authenticated route: the drag-to-reorder variant is a lazy client chunk
// mounted only when the owned-boards list is actually interacted with. ssr:false
// is fine — reorder is a pointer/keyboard-only affordance with no SSR value.
const BoardsNavSortable = dynamic(
  () => import("./BoardsNavSortable").then((m) => m.BoardsNavSortable),
  { ssr: false },
);

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
}: {
  board: BoardListEntry;
  isActive: boolean;
}) {
  return (
    <div
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
      />
    </div>
  );
}

export function BoardsNav({
  boards,
  sharedBoards,
  folders = [],
  placements = [],
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

  // Fold folders + placements into the tree once. `groupBoardsByFolder` owns the
  // "a folder with no visible board is dropped, not rendered empty" rule.
  const grouped = groupBoardsByFolder({
    folders,
    placements,
    boards,
    sharedBoards,
  });

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
      {grouped.folders.map(({ folder, boards: folderBoards }) => (
        <BoardFolderRow
          key={folder.id}
          folder={folder}
          count={folderBoards.length}
        >
          {folderBoards.map((entry) =>
            entry.kind === "owned" ? (
              <PlainBoardRow
                key={entry.board.id}
                board={entry.board}
                isActive={entry.board.id === activeBoardId}
              />
            ) : (
              <SharedBoardRow
                key={entry.board.id}
                board={entry.board}
                isActive={entry.board.id === activeBoardId}
              />
            ),
          )}
        </BoardFolderRow>
      ))}

      {grouped.unfiledOwned.length === 0 && grouped.folders.length === 0 ? (
        <p className="text-muted-foreground px-3 py-1 text-xs">No boards yet</p>
      ) : dndReady ? (
        <BoardsNavSortable
          boards={grouped.unfiledOwned}
          activeBoardId={activeBoardId}
        />
      ) : (
        <div
          data-testid="boards-nav-owned"
          onPointerEnter={() => setDndReady(true)}
          onFocus={() => setDndReady(true)}
        >
          {grouped.unfiledOwned.map((b) => (
            <PlainBoardRow
              key={b.id}
              board={b}
              isActive={b.id === activeBoardId}
            />
          ))}
        </div>
      )}

      {grouped.unfiledShared.length > 0 ? (
        <>
          <p className="text-muted-foreground px-3 pt-3 text-xs font-medium">
            Shared with me
          </p>
          {grouped.unfiledShared.map((b) => (
            <SharedBoardRow
              key={b.id}
              board={b}
              isActive={b.id === activeBoardId}
            />
          ))}
        </>
      ) : null}
    </NavSection>
  );
}
