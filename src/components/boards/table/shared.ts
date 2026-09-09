"use client";

import { type EditorMember } from "@/components/boards/cells/editors";
import {
  cellKey,
  type BoardCache,
  type CacheAttachment,
  type CacheCellValue,
  type CacheColumn,
} from "@/lib/boards/cache";
import type { Column } from "@/lib/boards/queries";
import { type RelationLink } from "@/lib/boards/relations";
import type { AggregationId, ColumnKind } from "@/lib/validations/boards";

/** The cell currently in edit mode, keyed by row + column. */
export type EditingCell = { itemId: string; columnId: string };

/**
 * Props threaded down to each editable cell.
 *
 * Deliberately does NOT carry the cell currently in edit mode: entering edit
 * mode is per-cell state, and holding it here handed every visible cell a new
 * bundle on each click. Cells subscribe to it individually instead — see
 * `useIsCellEditing` in ./editing-store.
 */
export type CellControls = {
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
  /**
   * The board's first status column (by position), resolved ONCE per table
   * render. Date cells derive their overdue tint from the item's value in this
   * column (see @/lib/boards/overdue) — resolving it per cell was a filter +
   * sort over every column on every render.
   */
  statusColumn: CacheColumn | null;
  /** Upload a file into a Files-column cell. */
  uploadColumnFile: (itemId: string, columnId: string, file: File) => void;
  /** Open the Files lightbox over a cell's attachments at the given index. */
  openFilesLightbox: (files: readonly CacheAttachment[], index: number) => void;
  /**
   * Full-res + thumbnail signed URLs for the attachments of the cell whose
   * lightbox was last opened (keyed by attachment id). Lazily minted on
   * lightbox open (0 round-trips on first paint); Files-cell chips read these
   * to upgrade from a kind icon to an image thumbnail, falling back to full-res.
   */
  filesPreviewUrls?: Record<string, string>;
  filesThumbUrls?: Record<string, string>;
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

/**
 * Every {@link BoardCache} slice EXCEPT `cellValues`.
 *
 * A cell edit (local or realtime) replaces `cache.cellValues` and therefore the
 * whole cache object, so plain identity on `controls.cache` reports "changed"
 * for every row on the board on every keystroke-commit. The row subtree reads
 * cell values only through the `cellMap` prop (compared per row — see
 * {@link rowCellsEqual}); everything else it reads off the cache lives in these
 * slices, so comparing them is what makes a row's memo honest AND effective.
 *
 * The invariant this rests on: nothing under a memoized row may read
 * `controls.cache.cellValues`. If it does, the row keeps a stale cache when a
 * foreign cell changes. (That was `isItemComplete`'s old call site; it now
 * reads `controls.statusColumn` + its own `cellMap` entry instead.)
 */
export const CACHE_SLICES = [
  "board",
  "groups",
  "columns",
  "items",
  "dependencies",
  "attachments",
  "timeEntries",
  "relationLinks",
  "mirrorTargetCells",
  "mirrorTargetColumns",
] as const satisfies readonly (keyof BoardCache)[];

/**
 * Props-equality for the {@link CellControls} bundle: identity on every field,
 * except `cache`, which is compared slice-by-slice minus `cellValues` (see
 * {@link CACHE_SLICES}).
 */
export function cellControlsEqual(a: CellControls, b: CellControls): boolean {
  if (a === b) return true;
  const keys = Object.keys(a) as (keyof CellControls)[];
  if (keys.length !== Object.keys(b).length) return false;
  for (const key of keys) {
    if (key === "cache") continue;
    if (!Object.is(a[key], b[key])) return false;
  }
  if (a.cache === b.cache) return true;
  return CACHE_SLICES.every((slice) =>
    Object.is(a.cache[slice], b.cache[slice]),
  );
}

/**
 * True when every (item × column) cell value the caller owns is unchanged
 * between two cell maps. `itemIds` is the row itself plus any subitems it rolls
 * up — the exact set of values a row renders — so a sibling row's edit compares
 * equal and the row's memo can skip it.
 */
export function rowCellsEqual(
  prev: Map<string, CacheCellValue["value"]>,
  next: Map<string, CacheCellValue["value"]>,
  itemIds: readonly string[],
  columns: readonly { id: string }[],
): boolean {
  if (prev === next) return true;
  for (const itemId of itemIds) {
    for (const column of columns) {
      const key = cellKey(itemId, column.id);
      if (!Object.is(prev.get(key), next.get(key))) return false;
    }
  }
  return true;
}

export const ROW_HEIGHT = 36; // direction C density

export const VALUE_COL_WIDTH = 180;
const ADD_COL_WIDTH = 44;

const CREATED_BY_WIDTH = 180;
const CREATED_AT_WIDTH = 180;

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
/**
 * Group-scoped actions, id-keyed so ONE bundle serves every group.
 *
 * The per-group inline closures this replaces (`onRenameGroup={(name) =>
 * renameGroup(group.id, name)}` and friends) were rebuilt on every
 * {@link BoardTable} render, which defeated {@link GroupSection}'s memo — and a
 * re-rendered group re-renders every row and cell under it.
 */
export type GroupControls = {
  rename: (groupId: string, name: string) => void;
  setColor: (groupId: string, color: string) => void;
  remove: (groupId: string) => void;
  toggleCollapsed: (groupId: string) => void;
  /** Clears the board-level "this group opened in rename mode" marker. */
  onRenameSettled: () => void;
};

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
