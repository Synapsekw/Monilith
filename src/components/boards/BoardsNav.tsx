"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { FolderKanban } from "lucide-react";
import type { BoardListEntry } from "@/lib/boards/queries";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { NewBoardDialog } from "@/components/boards/NewBoardDialog";

export function BoardsNav({
  boards,
  workspaces,
  collapsed = false,
}: {
  boards: BoardListEntry[];
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
      ) : (
        <div className="flex items-center justify-between px-3 py-1">
          <span className="text-muted-foreground flex items-center gap-2.5 text-sm">
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
                "truncate rounded-md px-3 py-1 text-sm transition-colors",
                b.id === activeBoardId
                  ? "bg-surface text-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {b.name}
            </Link>
          ),
        )
      )}
    </div>
  );
}
