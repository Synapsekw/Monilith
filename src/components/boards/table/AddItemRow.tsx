"use client";

import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import type { CellControls } from "./shared";

export function AddItemRow({
  groupId,
  controls,
  nameWidth,
  canEdit,
}: {
  groupId: string;
  controls: CellControls;
  nameWidth: number;
  /**
   * Board-level edit permission (`access !== "viewer"`, derived once in
   * {@link BoardTableInner}). Viewers — including every offline board, which
   * renders with `access="viewer"` — get NO add affordance at all rather than a
   * disabled one: an input they can never commit is noise, not information.
   */
  canEdit: boolean;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function commit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setError(null);
    startTransition(async () => {
      controls.addItem(
        { groupId, name: trimmed },
        {
          onSuccess: () => {
            setName("");
            setError(null);
          },
          onError: (err) => {
            setError(err.message);
          },
        },
      );
    });
  }

  // After the hooks (rules-of-hooks): the hook order is identical for viewers
  // and editors, only the output differs.
  if (!canEdit) return null;

  return (
    <div
      className="bg-surface sticky left-0 flex flex-col border-b px-4 py-1.5"
      style={{ width: nameWidth }}
    >
      <div className="flex items-center gap-2">
        <Plus className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
          }}
          disabled={isPending}
          placeholder="Add Item"
          aria-label="Add item"
          className="text-foreground placeholder:text-muted-foreground focus-visible:ring-ring w-full bg-transparent text-sm outline-none focus-visible:rounded-sm focus-visible:ring-2 disabled:opacity-50"
        />
      </div>
      {error ? (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      ) : null}
    </div>
  );
}
