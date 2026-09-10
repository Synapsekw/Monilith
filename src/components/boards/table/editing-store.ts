"use client";

import { create } from "zustand";
import type { EditingCell } from "./shared";

/**
 * Which cell of the board table is in edit mode.
 *
 * Why a store and not `useState` in BoardTable: the edited cell used to live in
 * the table's own state and travel down inside the `controls` bundle, so a
 * single click handed EVERY visible cell a new prop — ~300 `EditableCell`
 * re-renders to open one editor, and another ~300 to close it. Edit mode is
 * per-cell state, so each cell subscribes to just its own slice through
 * {@link useIsCellEditing}: the selector is `false` for every cell but one, and
 * a stable `false` is no re-render at all. Same shape (and same reason) as
 * `presence-focus-store`.
 *
 * `setEditing` is a store action, so it keeps ONE identity for the app's life —
 * callers hold it through `controls.setEditing` exactly as before.
 */
export type EditingCellState = {
  editing: EditingCell | null;
  setEditing: (cell: EditingCell | null) => void;
};

export const useEditingCell = create<EditingCellState>((set) => ({
  editing: null,
  setEditing: (cell) => set({ editing: cell }),
}));

/** Subscribe to "is THIS cell the one being edited?" — and nothing else. */
export function useIsCellEditing(itemId: string, columnId: string): boolean {
  return useEditingCell(
    (s) => s.editing?.itemId === itemId && s.editing?.columnId === columnId,
  );
}
