"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { FieldStatus, useFieldStatus } from "@/components/ui/field-status";
import { cn } from "@/lib/utils";
import { ROW_HAIRLINE, type CellControls } from "./shared";

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
          // Name the row that failed: the typed text is given back only if the
          // user hasn't already started typing the next item into this input,
          // so in that race the message is the only place it survives.
          setError(`Couldn't add "${trimmed}" — ${err.message}`);
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
      className={cn(
        "group/add bg-surface sticky left-0 flex flex-col px-4 py-1.5",
        ROW_HAIRLINE,
      )}
      style={{ width: nameWidth }}
    >
      <div className="flex items-center gap-2">
        <span
          data-testid="add-affordance"
          className="border-border-bright text-muted-foreground group-hover/add:border-primary group-hover/add:text-primary grid size-[18px] shrink-0 place-items-center rounded-md border border-dashed transition-colors"
        >
          <Plus className="size-3" aria-hidden />
        </span>
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
