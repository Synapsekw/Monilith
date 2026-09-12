"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { FieldStatus, useFieldStatus } from "@/components/ui/field-status";
import { NAME_FREEZE_RULE } from "@/components/boards/SummaryRow";
import { cn } from "@/lib/utils";
import { ROW_HAIRLINE, type CellControls } from "./shared";

/** Inline input row appended to the expanded subitem block. */
export function AddSubitemRow({
  parentId,
  controls,
  nameWidth,
}: {
  parentId: string;
  controls: CellControls;
  /** Same Name-column width every other frozen surface uses — threaded down
   *  exactly like {@link AddItemRow}'s own `nameWidth` prop, so the inner
   *  sticky element (not this row's full-width host) is what caps to the
   *  Name column and carries its permanent right-edge hairline. */
  nameWidth: number;
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
    // Full-width separator host — same shape as AddItemRow: this outer
    // element carries ONLY the row's top hairline (spanning every column),
    // while the actual content is pinned to the frozen Name column on the
    // INNER sticky element below. Splitting it this way is what closes the
    // gap a bare `border-r` on this full-width host would otherwise leave
    // in the Name column's permanent right-edge hairline — a single row
    // whose vertical rule silently didn't span the Name column's width
    // read as a rendering bug, not a deliberate omission.
    <div className={cn("w-full", ROW_HAIRLINE)}>
      <div
        // `bg-surface-sunken` here (not just on SubitemBlock's ambient
        // wrapper) is load-bearing: this element is `sticky left-0`, so it
        // paints OVER the data columns as they scroll underneath it — an
        // element relying on an ancestor's background would let the scrolled
        // columns bleed through (same reason NameCell's sticky wrapper is
        // always opaque). `pr-4 pl-10` is unchanged from before the split —
        // same background, same left indent, only the outer/inner structure
        // and the added rule are new.
        className={cn(
          "group/add bg-surface-sunken sticky left-0 flex flex-col py-1.5 pr-4 pl-10",
          NAME_FREEZE_RULE,
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
            placeholder="Add subitem"
            aria-label="Add subitem"
            className="text-foreground placeholder:text-muted-foreground text-cell w-full bg-transparent outline-none disabled:opacity-50"
            {...status.controlProps}
          />
        </div>
        <FieldStatus field={status} />
      </div>
    </div>
  );
}
