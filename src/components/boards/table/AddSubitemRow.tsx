"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { FieldStatus, useFieldStatus } from "@/components/ui/field-status";
import type { CellControls } from "./shared";

/** Inline input row appended to the expanded subitem block. */
export function AddSubitemRow({
  parentId,
  controls,
}: {
  parentId: string;
  controls: CellControls;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const status = useFieldStatus(error);

  /**
   * Optimistic, exactly like {@link AddItemRow}: `addSubitemMutation.onMutate`
   * paints the temp row, so the input clears immediately and never disables —
   * the user can type the next subitem straight away and commit with Enter
   * alone. (Before, the input disabled itself for the round-trip, which blurred
   * it and needed an effect to refocus once the transition settled.)
   *
   * The name is already what the user typed, so the new row deliberately does
   * NOT drop into rename mode — that required a second Enter to dismiss.
   */
  function commit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setError(null);
    setName("");
    controls.addSubitem(parentId, trimmed, {
      onError: (err) => {
        // Name the row that failed — the typed text is handed back only if the
        // next subitem isn't already being typed, so in that race this message
        // is the only place it survives. Inline (never a toast): same
        // caller-surfaced contract as AddItemRow.
        setError(`Couldn't add "${trimmed}" — ${err.message}`);
        setName((current) => (current === "" ? trimmed : current));
      },
    });
  }

  return (
    <div className="bg-surface-sunken sticky left-0 flex flex-col border-b py-1.5 pr-4 pl-12">
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
          placeholder="Add subitem"
          aria-label="Add subitem"
          className="text-foreground placeholder:text-muted-foreground w-full bg-transparent text-sm outline-none disabled:opacity-50"
          {...status.controlProps}
        />
      </div>
      <FieldStatus field={status} />
    </div>
  );
}
