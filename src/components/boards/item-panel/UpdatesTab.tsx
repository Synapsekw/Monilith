"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { UpdatesCache } from "@/lib/collaboration/cache";
import type { Member } from "@/lib/collaboration/activity";

export function UpdatesTab({
  cache,
  members,
  onAdd,
  onDelete,
}: {
  cache: UpdatesCache | undefined;
  members: readonly Member[];
  onAdd: (text: string) => void;
  onDelete: (updateId: string) => void;
}) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);

  function submit() {
    const t = text.trim();
    if (!t) return;
    onAdd(t);
    setText("");
    setOpen(false);
  }

  return (
    <div className="flex flex-col gap-4">
      {!open ? (
        <button
          className="text-muted-foreground hover:bg-accent rounded-md border px-3 py-2 text-left text-sm"
          onClick={() => setOpen(true)}
        >
          Write an update
        </button>
      ) : (
        <div className="flex flex-col gap-2">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoFocus
            rows={3}
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={submit}>
              Update
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setOpen(false);
                setText("");
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {!cache || cache.updates.length === 0 ? (
        <p className="text-muted-foreground py-6 text-center text-sm">
          No updates yet for this item.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {cache.updates.map((u) => (
            <li key={u.id} className="rounded-md border p-3 text-sm">
              <div className="text-muted-foreground mb-1 flex items-center justify-between text-xs">
                <span className="text-foreground font-medium">
                  {members.find((m) => m.userId === u.author_id)?.fullName ??
                    "Someone"}
                </span>
                <button
                  className="opacity-60 hover:opacity-100"
                  onClick={() => onDelete(u.id)}
                  aria-label="Delete update"
                >
                  Delete
                </button>
              </div>
              <p className="whitespace-pre-wrap">{u.body_text}</p>
              {u.edited_at && (
                <span className="text-muted-foreground text-xs">(edited)</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
