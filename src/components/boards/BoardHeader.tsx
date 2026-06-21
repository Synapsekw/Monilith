"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye, UserPlus, Zap } from "lucide-react";

import { ViewSwitcher } from "@/components/boards/ViewSwitcher";
import { AutomationsDialog } from "@/components/boards/automations/AutomationsDialog";
import { ShareBoardDialog } from "@/components/boards/ShareBoardDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { BoardView } from "@/lib/boards/queries";
import type { CacheColumn } from "@/lib/boards/cache";
import { useBoardMutations } from "@/lib/boards/use-board-mutations";

export type HeaderMember = {
  userId: string;
  fullName: string | null;
  email: string | null;
};

export type HeaderGrant = { userId: string; access: "viewer" | "editor" };

export type BoardAccess = "owner" | "editor" | "viewer";

export function BoardHeader({
  boardId,
  boardName,
  views,
  selectedViewId,
  columns = [],
  members = [],
  access = "owner",
  grants = [],
}: {
  boardId: string;
  boardName: string;
  views: BoardView[];
  selectedViewId: string;
  columns?: CacheColumn[];
  members?: HeaderMember[];
  /** The current user's access to this board. Owners can share; viewers are read-only. */
  access?: BoardAccess;
  /** Existing share grants, seeding the share dialog. Only meaningful for owners. */
  grants?: HeaderGrant[];
}) {
  const router = useRouter();
  const { renameBoard } = useBoardMutations(boardId);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(boardName);
  const [isPending, startTransition] = useTransition();
  const [automationsOpen, setAutomationsOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  const isOwner = access === "owner";
  const isViewer = access === "viewer";

  function openRename() {
    setName(boardName);
    setEditing(true);
  }

  function commitRename() {
    const trimmed = name.trim();
    setEditing(false);
    if (!trimmed || trimmed === boardName) return;
    startTransition(() => {
      renameBoard(trimmed, { onSuccess: () => router.refresh() });
    });
  }

  return (
    <header className="flex flex-col gap-2 border-b px-6 py-2">
      <div className="flex items-center gap-2">
        {editing && !isViewer ? (
          <Input
            autoFocus
            value={name}
            disabled={isPending}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitRename();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setEditing(false);
              }
            }}
            aria-label="Board name"
            className="h-8 max-w-md text-xl font-semibold"
          />
        ) : isViewer ? (
          <h1 className="truncate text-xl font-semibold tracking-tight">
            {boardName}
          </h1>
        ) : (
          <button
            type="button"
            onClick={openRename}
            className="hover:text-muted-foreground focus-visible:ring-ring rounded-sm text-left text-xl font-semibold tracking-tight transition-colors focus-visible:ring-2 focus-visible:outline-none"
          >
            {boardName}
          </button>
        )}
        {isViewer ? (
          <span className="bg-surface text-muted-foreground inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium">
            <Eye className="size-3.5" />
            View only
          </span>
        ) : null}
      </div>
      <div className="flex items-center justify-between gap-2">
        <ViewSwitcher
          boardId={boardId}
          views={views}
          selectedViewId={selectedViewId}
        />
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="Automations"
            onClick={() => setAutomationsOpen(true)}
          >
            <Zap className="size-3.5" /> Automations
          </Button>
          {isOwner ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label="Share board"
              onClick={() => setShareOpen(true)}
            >
              <UserPlus className="size-3.5" /> Share
            </Button>
          ) : null}
        </div>
      </div>
      <AutomationsDialog
        boardId={boardId}
        columns={columns}
        members={members}
        open={automationsOpen}
        onOpenChange={setAutomationsOpen}
      />
      {isOwner ? (
        <ShareBoardDialog
          boardId={boardId}
          members={members}
          grants={grants}
          open={shareOpen}
          onOpenChange={setShareOpen}
        />
      ) : null}
    </header>
  );
}
