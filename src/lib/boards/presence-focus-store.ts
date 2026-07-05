"use client";

import { create } from "zustand";
import type { PresenceFocus, RosterOccupant } from "./presence-types";

/**
 * Subscribable presence focus/flash state for the hot per-cell overlays
 * (PresenceRing, FlashHighlight) and the focus reporter (usePresenceFocus).
 *
 * Why a store and not the presence context: BoardViews rebuilds its presence
 * context value on every remote focus heartbeat (~6×/sec per active user), so
 * EVERY cell that read focus/flash off the context re-rendered on each beat —
 * a full-board re-render storm. This store lets each overlay subscribe with a
 * per-target selector: `focusMap.get(target)` is `undefined` for the ~all cells
 * nobody is editing (stable → no re-render), and {@link syncPresence} preserves
 * array identity for targets whose occupant set is unchanged, so a heartbeat
 * only re-renders the cell(s) whose presence actually changed.
 *
 * The presence *context* (BoardPresenceProvider) still carries the roster for
 * the (non-hot) avatar bars; this store is fed alongside it from BoardViews.
 */
type SetFocus = (focus: PresenceFocus | null) => void;

const noopFocus: SetFocus = () => {};

export type PresenceFocusState = {
  /** target id (e.g. `cell:i1:c1`) → other users currently focused there. */
  focusMap: Map<string, RosterOccupant[]>;
  /** The cell that just received a remote change under the local user's focus. */
  flashTargetId: string | null;
  selfUserId: string;
  /** Report the local user's focus target (stable across renders once fed). */
  setFocus: SetFocus;
  /** Feed the latest presence snapshot; only changed slices notify subscribers. */
  syncPresence: (input: {
    focusMap: Map<string, RosterOccupant[]>;
    flashTargetId: string | null;
    selfUserId: string;
    setFocus: SetFocus;
  }) => void;
  /** Clear on board unmount so presence never bleeds into the next board. */
  reset: () => void;
};

function sameOccupants(a: RosterOccupant[], b: RosterOccupant[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (
      a[i].userId !== b[i].userId ||
      a[i].color !== b[i].color ||
      a[i].name !== b[i].name
    )
      return false;
  }
  return true;
}

/**
 * Merge `next` into `prev`, reusing `prev`'s per-target arrays where the
 * occupant set is unchanged, and returning `prev` itself when nothing changed.
 * This is what makes per-target selectors (`s.focusMap.get(target)`) stable:
 * a heartbeat that only moves one user's focus yields new array identity for
 * exactly the affected target(s), so only those cells re-render.
 */
export function mergeFocusMap(
  prev: Map<string, RosterOccupant[]>,
  next: Map<string, RosterOccupant[]>,
): Map<string, RosterOccupant[]> {
  // Size mismatch means a target was added or removed → definitely changed.
  let changed = prev.size !== next.size;
  const merged = new Map<string, RosterOccupant[]>();
  for (const [target, occ] of next) {
    const prevOcc = prev.get(target);
    if (prevOcc && sameOccupants(prevOcc, occ)) {
      merged.set(target, prevOcc);
    } else {
      merged.set(target, occ);
      changed = true;
    }
  }
  return changed ? merged : prev;
}

export const usePresenceFocusStore = create<PresenceFocusState>((set, get) => ({
  focusMap: new Map(),
  flashTargetId: null,
  selfUserId: "",
  setFocus: noopFocus,
  syncPresence: ({ focusMap, flashTargetId, selfUserId, setFocus }) => {
    const prev = get();
    const nextMap = mergeFocusMap(prev.focusMap, focusMap);
    const patch: Partial<PresenceFocusState> = {};
    if (nextMap !== prev.focusMap) patch.focusMap = nextMap;
    if (flashTargetId !== prev.flashTargetId)
      patch.flashTargetId = flashTargetId;
    if (selfUserId !== prev.selfUserId) patch.selfUserId = selfUserId;
    if (setFocus !== prev.setFocus) patch.setFocus = setFocus;
    if (Object.keys(patch).length > 0) set(patch);
  },
  reset: () =>
    set({
      focusMap: new Map(),
      flashTargetId: null,
      selfUserId: "",
      setFocus: noopFocus,
    }),
}));
