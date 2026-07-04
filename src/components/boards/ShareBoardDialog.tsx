"use client";

import { useState, useTransition } from "react";
import { ChevronDown, UsersRound } from "lucide-react";
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

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "";
  return (first + last).toUpperCase() || "?";
}

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
    // Capture the persisted value so a failed write can be rolled back —
    // otherwise the <select> keeps showing the access level that never saved.
    const previous = access.get(userId) ?? "none";
    setAccess((prev) => new Map(prev).set(userId, next));
    start(async () => {
      setError(null);
      const r =
        next === "none"
          ? await unshareBoard({ boardId, userId })
          : await shareBoard({ boardId, userId, access: next });
      if (!r.ok) {
        setAccess((prev) => new Map(prev).set(userId, previous));
        setError(r.error);
      }
    });
  }

  const sharedCount = members.reduce(
    (n, m) => n + ((access.get(m.userId) ?? "none") !== "none" ? 1 : 0),
    0,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-4 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Share board</DialogTitle>
          <DialogDescription>
            Give people in your organization access to this board. They&rsquo;ll
            find it under &ldquo;Shared with me&rdquo;.
          </DialogDescription>
        </DialogHeader>

        {members.length === 0 ? (
          <div className="bg-surface-muted/40 flex flex-col items-center gap-2 rounded-lg border px-6 py-10 text-center">
            <span className="bg-surface text-muted-foreground flex size-10 items-center justify-center rounded-full border">
              <UsersRound className="size-5" />
            </span>
            <p className="text-foreground text-sm font-medium">
              No one else is here yet
            </p>
            <p className="text-muted-foreground max-w-xs text-xs text-pretty">
              Invite people to your organization in Settings, then come back to
              share this board with them.
            </p>
          </div>
        ) : (
          <div className="bg-surface-muted/40 divide-border max-h-[min(60vh,22rem)] divide-y overflow-y-auto rounded-lg border">
            {members.map((m) => {
              const name = m.fullName ?? m.email ?? "Unknown member";
              const current = access.get(m.userId) ?? "none";
              const secondary = m.fullName ? m.email : null;
              return (
                <div
                  key={m.userId}
                  className="flex items-center gap-3 px-3 py-2.5"
                >
                  <span
                    aria-hidden
                    className="bg-surface text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-full border text-xs font-medium"
                  >
                    {initials(name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="text-foreground block truncate text-sm font-medium">
                      {name}
                    </span>
                    {secondary && (
                      <span className="text-muted-foreground block truncate text-xs">
                        {secondary}
                      </span>
                    )}
                  </span>
                  <div className="relative shrink-0">
                    <select
                      aria-label={`Access for ${name}`}
                      value={current}
                      onChange={(e) =>
                        change(m.userId, e.target.value as Access)
                      }
                      disabled={pending}
                      className={cn(
                        "border-border bg-background text-foreground hover:bg-accent focus-visible:ring-ring/50 focus-visible:border-ring h-9 w-32 appearance-none rounded-md border pr-8 pl-3 text-sm capitalize transition-colors",
                        "focus-visible:ring-3 focus-visible:outline-none",
                        "disabled:pointer-events-none disabled:opacity-50",
                        current === "none" && "text-muted-foreground",
                      )}
                    >
                      <option value="none">No access</option>
                      <option value="viewer">Viewer</option>
                      <option value="editor">Editor</option>
                    </select>
                    <ChevronDown
                      aria-hidden
                      className="text-muted-foreground pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {error ? (
          <p role="alert" className="text-destructive text-xs">
            {error}
          </p>
        ) : members.length > 0 ? (
          <p className="text-muted-foreground text-xs">
            {sharedCount === 0
              ? "Private — only you can see this board."
              : `Shared with ${sharedCount} ${sharedCount === 1 ? "person" : "people"}.`}
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
