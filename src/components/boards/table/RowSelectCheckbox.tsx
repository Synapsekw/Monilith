"use client";

import { memo } from "react";
import { cn } from "@/lib/utils";
import { useBoardSelection } from "@/stores/board-selection";

/**
 * Per-row selection checkbox. Subscribes ONLY to whether its own id is selected
 * (a boolean selector), so toggling one row re-renders that one checkbox — not
 * the virtualized row tree (which subscribes to the TanStack board cache, a
 * different store). Shift-click extends a range via the store's ordered id list.
 */
export const RowSelectCheckbox = memo(function RowSelectCheckbox({
  itemId,
  name,
}: {
  itemId: string;
  name: string;
}) {
  const selected = useBoardSelection((s) => s.selectedIds.has(itemId));
  const toggle = useBoardSelection((s) => s.toggle);
  return (
    <label
      className={cn(
        "grid size-6 shrink-0 cursor-pointer place-items-center rounded transition-opacity pointer-coarse:size-11 pointer-coarse:opacity-100",
        selected
          ? "opacity-100"
          : "opacity-0 group-hover/name:opacity-100 focus-within:opacity-100",
      )}
    >
      <input
        type="checkbox"
        checked={selected}
        aria-label={`Select ${name}`}
        onChange={() => {}}
        onClick={(e) => {
          e.stopPropagation();
          toggle(itemId, e.shiftKey);
        }}
        className="accent-primary size-3.5 cursor-pointer"
      />
    </label>
  );
});
