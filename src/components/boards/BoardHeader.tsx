"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { ViewSwitcher } from "@/components/boards/ViewSwitcher";
import { Input } from "@/components/ui/input";
import type { BoardView } from "@/lib/boards/queries";
import { useBoardMutations } from "@/lib/boards/use-board-mutations";

export function BoardHeader({
  boardId,
  boardName,
  views,
  selectedViewId,
}: {
  boardId: string;
  boardName: string;
  views: BoardView[];
  selectedViewId: string;
}) {
  const router = useRouter();
  const { renameBoard } = useBoardMutations(boardId);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(boardName);
  const [isPending, startTransition] = useTransition();

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
      {editing ? (
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
      ) : (
        <button
          type="button"
          onClick={openRename}
          className="hover:text-muted-foreground focus-visible:ring-ring rounded-sm text-left text-xl font-semibold tracking-tight transition-colors focus-visible:ring-2 focus-visible:outline-none"
        >
          {boardName}
        </button>
      )}
      <ViewSwitcher
        boardId={boardId}
        views={views}
        selectedViewId={selectedViewId}
      />
    </header>
  );
}
