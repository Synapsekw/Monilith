"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { FieldStatus, useFieldStatus } from "@/components/ui/field-status";
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
  const status = useFieldStatus(error);

  /**
   * The add is OPTIMISTIC (see `addItemMutation` in `lib/boards/mutations/items`):
   * the row is painted from `onMutate` before the round-trip, so this input has
   * nothing to wait for. It therefore no longer disables itself mid-flight —
   * which is what used to drop focus to `<body>` and forced
   * `useRestoreFocusAfterPending` to claw it back. Keeping the input enabled
   * gets the same outcome structurally: focus never leaves, and the next item
   * can be typed immediately instead of serialising on network latency.
   */
  function commit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setError(null);
    setName("");
    controls.addItem(
      { groupId, name: trimmed },
      {
        onError: (err) => {
          setError(err.message);
          // Give the typed text back so nothing is lost — but only if the user
          // hasn't already started typing the next item into the same input.
          setName((current) => (current === "" ? trimmed : current));
        },
      },
    );
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
          placeholder="Add Item"
          aria-label="Add item"
          className="text-foreground placeholder:text-muted-foreground focus-visible:ring-ring w-full bg-transparent text-sm outline-none focus-visible:rounded-sm focus-visible:ring-2 disabled:opacity-50"
          {...status.controlProps}
        />
      </div>
      <FieldStatus field={status} />
    </div>
  );
}
