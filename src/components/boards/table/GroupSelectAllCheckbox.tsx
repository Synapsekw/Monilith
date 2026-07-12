"use client";

import { useBoardSelection } from "@/stores/board-selection";

/**
 * Group-header "select all visible" checkbox. Reflects none/some/all of the
 * group's currently-visible (filtered) top-level rows and toggles the whole set.
 * Subscribes to the count of that group's selected ids, so it updates as rows
 * toggle without touching the row tree.
 */
export function GroupSelectAllCheckbox({
  visibleIds,
}: {
  visibleIds: string[];
}) {
  const selectedCount = useBoardSelection(
    (s) => visibleIds.filter((id) => s.selectedIds.has(id)).length,
  );
  const setSelected = useBoardSelection((s) => s.setSelected);
  const all = visibleIds.length > 0 && selectedCount === visibleIds.length;
  const some = selectedCount > 0 && !all;
  return (
    <label className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-md pointer-coarse:size-11">
      <input
        type="checkbox"
        checked={all}
        ref={(el) => {
          if (el) el.indeterminate = some;
        }}
        aria-label="Select all visible items in this group"
        onChange={() => setSelected(visibleIds, !all)}
        className="accent-primary size-3.5 cursor-pointer"
      />
    </label>
  );
}
