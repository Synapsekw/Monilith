"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FolderKanban, Plus } from "lucide-react";
import { createBoard } from "@/lib/boards/actions";
import type { BoardListEntry } from "@/lib/boards/queries";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export function BoardsNav({
  boards,
  workspaces,
  activeBoardId,
}: {
  boards: BoardListEntry[];
  workspaces: { id: string; name: string }[];
  activeBoardId?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const workspaceId = workspaces[0]?.id;

  function submit() {
    if (!workspaceId) return;
    setError(null);
    startTransition(async () => {
      const res = await createBoard({ workspaceId, name });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOpen(false);
      setName("");
      router.push(`/boards/${res.data.boardId}`);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-0.5 px-2 py-2">
      <div className="flex items-center justify-between px-3 py-1">
        <span className="text-muted-foreground flex items-center gap-2.5 text-sm">
          <FolderKanban className="size-4" />
          Boards
        </span>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="New board"
              className="size-6"
            >
              <Plus className="size-4" />
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New board</DialogTitle>
            </DialogHeader>
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
            >
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="board-name">Board name</Label>
                <Input
                  id="board-name"
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Sprint backlog"
                />
              </div>
              {error ? (
                <p role="alert" className="text-destructive text-xs">
                  {error}
                </p>
              ) : null}
              <DialogFooter>
                <Button type="submit" disabled={isPending || !name.trim()}>
                  {isPending ? "Creating…" : "Create board"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {boards.length === 0 ? (
        <p className="text-muted-foreground px-3 py-1 text-xs">No boards yet</p>
      ) : (
        boards.map((b) => (
          <Link
            key={b.id}
            href={`/boards/${b.id}`}
            className={cn(
              "truncate rounded-md px-3 py-1.5 text-sm transition-colors",
              b.id === activeBoardId
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {b.name}
          </Link>
        ))
      )}
    </div>
  );
}
