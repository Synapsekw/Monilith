"use client";

import { useState, useTransition } from "react";
import { shareBoard, unshareBoard } from "@/lib/boards/sharing-actions";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type Member = { userId: string; fullName: string | null; email: string | null };
type Grant = { userId: string; access: "viewer" | "editor" };
type Access = "none" | "viewer" | "editor";

export function ShareBoardDialog({
  boardId,
  members,
  grants,
  open,
  onOpenChange,
}: {
  boardId: string;
  members: Member[];
  grants: Grant[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const initial = new Map<string, Access>(
    grants.map((g) => [g.userId, g.access]),
  );
  const [access, setAccess] = useState<Map<string, Access>>(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function change(userId: string, next: Access) {
    setAccess((prev) => new Map(prev).set(userId, next));
    start(async () => {
      setError(null);
      const r =
        next === "none"
          ? await unshareBoard({ boardId, userId })
          : await shareBoard({ boardId, userId, access: next });
      if (!r.ok) setError(r.error);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share board</DialogTitle>
          <DialogDescription>
            Give people in your organization access to this board.
          </DialogDescription>
        </DialogHeader>

        {members.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No one else is in your organization yet. Invite people in Settings.
          </p>
        ) : (
          <ul className="divide-border divide-y text-sm">
            {members.map((m) => {
              const name = m.fullName ?? m.email ?? "Unknown member";
              return (
                <li
                  key={m.userId}
                  className="flex items-center justify-between gap-3 py-2.5"
                >
                  <span className="min-w-0 truncate">
                    <span className="text-foreground">{name}</span>
                    {m.fullName && m.email && (
                      <span className="text-muted-foreground">
                        {" "}
                        · {m.email}
                      </span>
                    )}
                  </span>
                  <select
                    aria-label={`Access for ${name}`}
                    value={access.get(m.userId) ?? "none"}
                    onChange={(e) => change(m.userId, e.target.value as Access)}
                    disabled={pending}
                    className={cn(
                      "border-border bg-background text-foreground hover:bg-accent focus-visible:ring-ring/50 focus-visible:border-ring h-9 shrink-0 rounded-md border px-3 text-sm capitalize transition-colors",
                      "focus-visible:ring-3 focus-visible:outline-none",
                      "disabled:pointer-events-none disabled:opacity-50",
                    )}
                  >
                    <option value="none">No access</option>
                    <option value="viewer">Viewer</option>
                    <option value="editor">Editor</option>
                  </select>
                </li>
              );
            })}
          </ul>
        )}

        {error && (
          <p role="alert" className="text-destructive text-xs">
            {error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
