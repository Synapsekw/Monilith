"use client";

import { type EditorMember } from "@/components/boards/cells/editors";
import type { BoardCache, CacheAttachment } from "@/lib/boards/cache";
import type { Column } from "@/lib/boards/queries";
import { type RelationLink } from "@/lib/boards/relations";
import type { AggregationId, ColumnKind } from "@/lib/validations/boards";

/** The cell currently in edit mode, keyed by row + column. */
export type EditingCell = { itemId: string; columnId: string };

/** Props threaded down to each editable cell. */
export type CellControls = {
  editing: EditingCell | null;
  setEditing: (cell: EditingCell | null) => void;
  setCell: (vars: { itemId: string; columnId: string; value: unknown }) => void;
  clearCellValue: (vars: { itemId: string; columnId: string }) => void;
  members: EditorMember[];
  boardId: string;
  /** The signed-in user's id — threaded from the board page server component. */
  currentUserId: string;
  addItem: (
    vars: { groupId: string; name: string },
    callbacks?: { onSuccess?: () => void; onError?: (err: Error) => void },
  ) => void;
  renameItemInCache: (vars: { itemId: string; name: string }) => void;
  addSubitem: (
    parentId: string,
    name: string,
    callbacks?: {
      onSuccess?: (id: string) => void;
      onError?: (err: Error) => void;
    },
  ) => void;
  deleteItem: (itemId: string) => void;
  reorderItem: (itemId: string, position: number) => void;
  moveItemToGroup: (itemId: string, groupId: string, position?: number) => void;
  /** Live board cache — read by Files cells to resolve their attachments. */
  cache: BoardCache;
  /**
   * Direct-dependent counts for priority cells: one O(edges) pass over the
   * board's dependency set, computed once in {@link BoardTable} and threaded
   * down (same pattern as cellMap) instead of recomputed inside every visible
   * row. Priority cells read `dependentsByItem.get(item.id) ?? 0`.
   */
  dependentsByItem: Map<string, number>;
  /** Upload a file into a Files-column cell. */
  uploadColumnFile: (itemId: string, columnId: string, file: File) => void;
  /** Open the Files lightbox over a cell's attachments at the given index. */
  openFilesLightbox: (files: readonly CacheAttachment[], index: number) => void;
  // ─── Time-tracking callbacks ───────────────────────────────────────────────
  startTimer: (itemId: string, columnId: string) => void;
  stopTimer: (entryId: string) => void;
  addManualEntry: (
    itemId: string,
    columnId: string,
    date: string,
    durationSecs: number,
  ) => void;
  editEntry: (entryId: string, date: string, durationSecs: number) => void;
  deleteEntry: (entryId: string) => void;
  setEstimate: (
    itemId: string,
    columnId: string,
    estimateSeconds: number | null,
  ) => void;
  // ─── Relation callbacks ──────────────────────────────────────────────────────
  setRelationLinks: (vars: {
    itemId: string;
    columnId: string;
    links: RelationLink[];
  }) => void;
};

export const ROW_HEIGHT = 36; // direction C density

export const VALUE_COL_WIDTH = 180;
export const ADD_COL_WIDTH = 44;

export const CREATED_BY_WIDTH = 180;
export const CREATED_AT_WIDTH = 180;

/** CSS grid template: pinned Name + one fixed px track per column + the add-column slot. */
export function gridTemplate(
  columns: { id: string; width: number | null }[],
  liveWidths: Record<string, number>,
  nameWidth: number,
): string {
  const tracks = columns
    .map((c) => `${liveWidths[c.id] ?? c.width ?? VALUE_COL_WIDTH}px`)
    .join(" ");
  return `${nameWidth}px ${tracks} ${CREATED_BY_WIDTH}px ${CREATED_AT_WIDTH}px ${ADD_COL_WIDTH}px`;
}

/**
 * Board-level column-management surface, shared by every group's header row.
 * Columns are board-scoped, so a resize/add/rename/delete from ANY group must
 * reflow all groups + the footer — the width state (`liveWidths`/name width)
 * therefore lives in {@link BoardTable} and is threaded down through this bundle
 * (mirrors the {@link CellControls} pattern).
 */
/**
 * Per-group summary-row wiring shared by every {@link GroupSection}: the
 * aggregation choice is per column and board-global (D1), so the edit
 * permission, the "now" snapshot, and the persist callback are built once in
 * {@link BoardTable} and threaded down — the group rows differ only in scope
 * (their own top-level `items`).
 */
export type GroupSummaryControls = {
  canEdit: boolean;
  nowMs: number;
  onChange: (col: Column, agg: AggregationId | null) => void;
};

export type ColumnHeaderControls = {
  nameWidth: number;
  liveWidths: Record<string, number>;
  setLiveWidths: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  setLiveNameWidth: (w: number | null) => void;
  renameColumn: (id: string, name: string) => void;
  deleteColumn: (id: string) => void;
  resizeColumn: (id: string, w: number) => void;
  reorderColumn: (id: string, position: number) => void;
  resizeNameColumn: (w: number | null) => void;
  onAddColumn: (kind: ColumnKind) => void;
  onEditOptions: (col: Column) => void;
  onEditCurrency: (col: Column) => void;
  onSmartFill: (col: Column) => void;
};
