import { create } from "zustand";
import { isOptimisticId } from "@/lib/boards/optimistic-id";

/**
 * Ephemeral row-selection state for the board Table view. This is PURE CLIENT UI
 * state — never persisted, never a server round-trip, never in the URL. It lives
 * outside the TanStack board cache on purpose: toggling a checkbox must NOT
 * invalidate/re-render the virtualized row tree (which subscribes to the board
 * cache). Only the components that subscribe to THIS store (the per-row
 * checkboxes, the group select-all, and the floating bulk bar) re-render on a
 * toggle — see the selector subscriptions in BoardTable / BoardBulkBar.
 *
 * Selection is scoped to a single mounted board Table view and cleared on view
 * change / unmount (BoardTable owns that lifecycle). Only TOP-LEVEL items are
 * selectable (bulk move/delete operate on top-level rows; subitems follow their
 * parent), so callers pass top-level item ids exclusively.
 *
 * Optimistic rows are NEVER selectable. A row added optimistically carries a
 * client-minted `optimistic-*` id (see @/lib/boards/optimistic-id) that the
 * server does not have yet, and every bulk action validates its payload as
 * `z.array(uuid)` — so ONE temp id in the set fails the entire bulk
 * archive/move/set-cell. The per-row checkbox disables itself, but that is not
 * the only entry path (group select-all passes raw visible ids, a shift-click
 * range sweeps everything between two anchors), so the filter lives HERE, at
 * the one choke point every path goes through. Deselection is deliberately not
 * filtered: it must always be able to clear a stale id.
 */
export interface BoardSelectionState {
  /** Currently-selected top-level item ids. */
  selectedIds: Set<string>;
  /** Anchor for shift-click range selection (last single-toggled id). */
  anchorId: string | null;
  /**
   * The ordered, currently-visible (filtered + sorted) top-level item ids, in
   * display order across all groups. Kept in sync by BoardTable so a shift-click
   * range can be resolved without threading the list through every checkbox.
   */
  orderedIds: string[];
  setOrderedIds: (ids: string[]) => void;
  /**
   * Toggle a single id. With `shiftKey` and a prior anchor (both still visible),
   * selects the contiguous range between the anchor and this id instead.
   */
  toggle: (id: string, shiftKey?: boolean) => void;
  /** Bulk set a list of ids selected/deselected (group select-all / clear). */
  setSelected: (ids: readonly string[], selected: boolean) => void;
  /** Deselect everything (fired on a completed bulk op or view change). */
  clear: () => void;
}

export const useBoardSelection = create<BoardSelectionState>((set, get) => ({
  selectedIds: new Set<string>(),
  anchorId: null,
  orderedIds: [],
  setOrderedIds: (ids) => set({ orderedIds: ids }),
  toggle: (id, shiftKey = false) => {
    const { selectedIds, anchorId, orderedIds } = get();
    // Range select: anchor + target both known → select the inclusive span.
    if (shiftKey && anchorId && anchorId !== id) {
      const from = orderedIds.indexOf(anchorId);
      const to = orderedIds.indexOf(id);
      if (from !== -1 && to !== -1) {
        const [lo, hi] = from < to ? [from, to] : [to, from];
        const next = new Set(selectedIds);
        for (let i = lo; i <= hi; i++) {
          if (!isOptimisticId(orderedIds[i])) next.add(orderedIds[i]);
        }
        // Anchor stays put so the user can extend the range further.
        set({ selectedIds: next });
        return;
      }
    }
    if (isOptimisticId(id)) return;
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    set({ selectedIds: next, anchorId: id });
  },
  setSelected: (ids, selected) => {
    const next = new Set(get().selectedIds);
    if (selected) {
      for (const id of ids) if (!isOptimisticId(id)) next.add(id);
    } else {
      for (const id of ids) next.delete(id);
    }
    set({ selectedIds: next });
  },
  clear: () => set({ selectedIds: new Set<string>(), anchorId: null }),
}));
