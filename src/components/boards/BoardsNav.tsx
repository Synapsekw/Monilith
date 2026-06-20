"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { FolderKanban, Users2 } from "lucide-react";
import type { BoardListEntry, SharedBoardEntry } from "@/lib/boards/queries";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { NewBoardDialog } from "@/components/boards/NewBoardDialog";

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
          <span className="text-muted-foreground flex items-center gap-2.5 text-sm">
            <FolderKanban className="size-4" />
            Boards
          </span>
          <NewBoardDialog workspaceId={workspaces[0]?.id} />
        </div>
      )}

      {/* My boards */}
      {!collapsed && (
        <p className="text-muted-foreground px-3 pt-1 text-xs font-medium">
          My boards
        </p>
      )}

      {boards.length === 0 ? (
        collapsed ? null : (
          <p className="text-muted-foreground px-3 py-1 text-xs">
            No boards yet
          </p>
        )
      ) : (
        boards.map((b) =>
          collapsed ? (
            <Tooltip key={b.id}>
              <TooltipTrigger asChild>
                <Link
                  href={`/boards/${b.id}`}
                  aria-current={b.id === activeBoardId ? "page" : undefined}
                  aria-label={b.name}
                  className={cn(
                    "flex size-9 items-center justify-center rounded-md text-sm font-medium uppercase transition-colors",
                    b.id === activeBoardId
                      ? "bg-surface text-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  {b.name.charAt(0)}
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right">{b.name}</TooltipContent>
            </Tooltip>
          ) : (
            <Link
              key={b.id}
              href={`/boards/${b.id}`}
              aria-current={b.id === activeBoardId ? "page" : undefined}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1 text-sm transition-colors",
                b.id === activeBoardId
                  ? "bg-surface text-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <span className="truncate">{b.name}</span>
              {b.shared_out ? (
                <Users2
                  aria-label="Shared with others"
                  className="text-muted-foreground size-3.5 shrink-0"
                />
              ) : null}
            </Link>
          ),
        )
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
                      ? "bg-surface text-foreground"
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
                  "flex flex-col rounded-md px-3 py-1 text-sm transition-colors",
                  b.id === activeBoardId
                    ? "bg-surface text-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <span className="truncate">{b.name}</span>
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
