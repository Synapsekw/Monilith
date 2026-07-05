"use client";

import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ChevronDown,
  ChevronRight,
  Clock,
  GripVertical,
  Maximize2,
  MoreHorizontal,
  Plus,
  User,
  X,
} from "lucide-react";
import {
  CreatedAtCell,
  CreatedByCell,
} from "@/components/boards/cells/created";
import { DndContext, type DragEndEvent } from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import {
  restrictToHorizontalAxis,
  restrictToVerticalAxis,
} from "@dnd-kit/modifiers";
import { CSS } from "@dnd-kit/utilities";
import { useTouchAwareSensors } from "@/lib/dnd/sensors";
import { reorderPosition } from "@/lib/boards/group-reorder";
import { bucketItems, withSubitems } from "@/lib/boards/item-tree";
import type { BoardPayload, Column, Group, Item } from "@/lib/boards/queries";
import type {
  AggregationId,
  ColumnKind,
  ColumnOption,
} from "@/lib/validations/boards";
import { CellRenderer } from "@/components/boards/cells";
import { isItemComplete, isOverdue, localTodayISO } from "@/lib/boards/overdue";
import { buildDependentsCountMap } from "@/lib/boards/priority";
import { FlashHighlight } from "@/components/boards/presence/FlashHighlight";
import { PresenceRing } from "@/components/boards/presence/PresenceRing";
import { presenceTarget } from "@/lib/boards/presence-target";
import { usePresenceFocus } from "@/lib/boards/use-presence-focus";
import { FilesCell } from "@/components/boards/cells/FilesCell";
import { TimeTrackingCell } from "@/components/boards/cells/TimeTrackingCell";
import { RelationCell } from "@/components/boards/cells/RelationCell";
import { MirrorCell } from "@/components/boards/cells/MirrorCell";
import { RelationColumnConfig } from "@/components/boards/RelationColumnConfig";
import { MirrorColumnConfig } from "@/components/boards/MirrorColumnConfig";
import {
  mirrorValuesForCell,
  mirrorTargetColumnFor,
} from "@/lib/boards/mirror";
import {
  SummaryRow,
  hasAssignedSummary,
  NAME_FREEZE_EDGE,
} from "@/components/boards/SummaryRow";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  listMirrorableColumns,
  listRelationCandidates,
  listRelationTargetBoards,
} from "@/lib/boards/relation-candidates";
import { type RelationLink } from "@/lib/boards/relations";
import { FilePreviewLightbox } from "@/components/boards/item-panel/FilePreviewLightbox";
import {
  getAttachmentDownloadUrl,
  getAttachmentPreviewUrls,
} from "@/lib/collaboration/actions";
import { RollupValueCell } from "@/components/boards/RollupValueCell";
import { BoardHeader } from "@/components/boards/BoardHeader";
import type { BoardAccess, HeaderGrant } from "@/components/boards/BoardHeader";
import { Input } from "@/components/ui/input";
import {
  CellEditor,
  type EditorMember,
} from "@/components/boards/cells/editors";
import type {
  BoardCache,
  CacheAttachment,
  CacheCellValue,
  CacheColumn,
} from "@/lib/boards/cache";
import {
  buildCellMap,
  cellKey,
  filesForCell,
  timeEntriesForCell,
  relationLinksForCell,
} from "@/lib/boards/cache";
import { countOptionUsage } from "@/lib/boards/option-edit";
import { ColumnOptionsDialog } from "@/components/boards/ColumnOptionsDialog";
import { CurrencyDialog } from "@/components/boards/CurrencyDialog";
import { useBoardCache } from "@/lib/boards/use-board-cache";
import { useBoardMutations } from "@/lib/boards/use-board-mutations";
import { useBoardFilterSort } from "@/lib/boards/use-board-filter-sort";
import {
  buildItemPredicate,
  buildItemComparator,
} from "@/lib/boards/board-filter";
import { EmptyState } from "@/components/ui/empty-state";
import { ColumnHeader } from "@/components/boards/ColumnHeader";
import { AddColumnMenu } from "@/components/boards/AddColumnMenu";
import {
  clampDragWidth,
  fitNameColumnWidth,
  NAME_COL_MAX,
} from "@/lib/boards/name-column-width";
import { cn } from "@/lib/utils";
import { GROUP_COLORS } from "@/lib/boards/group-colors";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useRafCallback } from "@/lib/hooks/use-raf-callback";
import { useBoardSelection } from "@/stores/board-selection";
import { BoardBulkBar } from "@/components/boards/BoardBulkBar";

type Settings = Record<string, unknown> & { options?: ColumnOption[] };

/** The cell currently in edit mode, keyed by row + column. */
type EditingCell = { itemId: string; columnId: string };

/** Props threaded down to each editable cell. */
type CellControls = {
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
  /** Live board cache — read by Files cells to resolve their attachments. */
  cache: BoardCache;
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

const ROW_HEIGHT = 36; // direction C density

// useLayoutEffect warns during SSR; this client component still pre-renders on
// the server, so fall back to useEffect there.
const useIsoLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

/**
 * Open the item detail panel by setting `?item=<id>` via the History API — no
 * RSC navigation, so the board page's queries don't re-run (mirrors how
 * `ViewSwitcher` sets `?view=`). {@link BoardViews} reads the param and renders
 * the panel.
 */
function openItemPanel(itemId: string) {
  const url = new URL(window.location.href);
  url.searchParams.set("item", itemId);
  window.history.pushState({}, "", url);
}
const VALUE_COL_WIDTH = 180;
const ADD_COL_WIDTH = 44;
const NAME_DRAG_MIN = 80; // manual drag floor (matches ColumnHeader MIN)
const CREATED_BY_WIDTH = 180;
const CREATED_AT_WIDTH = 180;

/** CSS grid template: pinned Name + one fixed px track per column + the add-column slot. */
function gridTemplate(
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
type GroupSummaryControls = {
  canEdit: boolean;
  nowMs: number;
  onChange: (col: Column, agg: AggregationId | null) => void;
};

type ColumnHeaderControls = {
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
};

/**
 * Per-row selection checkbox. Subscribes ONLY to whether its own id is selected
 * (a boolean selector), so toggling one row re-renders that one checkbox — not
 * the virtualized row tree (which subscribes to the TanStack board cache, a
 * different store). Shift-click extends a range via the store's ordered id list.
 */
const RowSelectCheckbox = memo(function RowSelectCheckbox({
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

/**
 * Group-header "select all visible" checkbox. Reflects none/some/all of the
 * group's currently-visible (filtered) top-level rows and toggles the whole set.
 * Subscribes to the count of that group's selected ids, so it updates as rows
 * toggle without touching the row tree.
 */
function GroupSelectAllCheckbox({ visibleIds }: { visibleIds: string[] }) {
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

// Public component: a memo wrapper over the implementation below (function
// declaration is hoisted, so referencing it here is safe).
export const BoardTable = memo(BoardTableInner);

// Memoized: BoardViews re-renders on every remote presence heartbeat (~6×/sec
// per active user), but BoardTable's props (payload/members/view/access/grants)
// are stable across those beats and it reads all live board data from its own
// `useBoardCache` (TanStack) subscription — so it re-renders on real cache
// changes (edits, realtime) regardless of memo, while skipping the heartbeat
// re-render cascade that previously re-rendered every visible row/cell. Presence
// overlays now subscribe to the presence focus store directly (see
// presence-focus-store.ts), so they still update per-cell without this re-render.
function BoardTableInner({
  payload,
  members = [],
  selectedViewId,
  currentUserId = "",
  access = "owner",
  grants = [],
}: {
  payload: BoardPayload;
  members?: EditorMember[];
  selectedViewId: string;
  currentUserId?: string;
  access?: BoardAccess;
  grants?: HeaderGrant[];
}) {
  // Hydrate the ["board", boardId] cache once from the server payload; read all
  // board data from the cache so optimistic + realtime patches re-render.
  const { data: cache } = useBoardCache(
    payload.board.id,
    payload as unknown as BoardCache,
  );
  const { board, groups, columns, items, cellValues } = cache;

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [scrolledX, setScrolledX] = useState(false);

  const [editing, setEditing] = useState<EditingCell | null>(null);
  const [renameGroupId, setRenameGroupId] = useState<string | null>(null);
  const [renamingItemId, setRenamingItemId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [optionsFor, setOptionsFor] = useState<CacheColumn | null>(null);
  // "Change currency" dialog target (currency columns only).
  const [currencyFor, setCurrencyFor] = useState<CacheColumn | null>(null);
  // Relation add-column flow: when "Relation" is picked we collect a target
  // board + allow-multiple before creating the column (settings are required).
  const [relationConfigOpen, setRelationConfigOpen] = useState(false);
  const [relationTargetBoards, setRelationTargetBoards] = useState<
    { id: string; name: string }[]
  >([]);
  // Mirror add-column flow: picking "Mirror" opens a dialog to choose a source
  // relation column on this board + a column on its target board to reflect.
  const [mirrorConfigOpen, setMirrorConfigOpen] = useState(false);

  // Files-column lightbox state. The viewed cell's attachments and the active
  // index live here; preview URLs are minted lazily on open (only for that
  // cell's files) so first paint stays 0 round-trips (gotcha-09). Cell
  // thumbnails themselves render icons only — no signed URLs on load.
  const [filesLightbox, setFilesLightbox] = useState<{
    files: CacheAttachment[];
    index: number;
  } | null>(null);
  const [filesPreviewUrls, setFilesPreviewUrls] = useState<
    Record<string, string>
  >({});

  function openFilesLightbox(files: readonly CacheAttachment[], index: number) {
    const list = [...files];
    setFilesLightbox({ files: list, index });
    setFilesPreviewUrls({});
    void getAttachmentPreviewUrls({
      attachmentIds: list.map((a) => a.id),
    }).then((res) => {
      if (res.ok) setFilesPreviewUrls(res.data.urls);
    });
  }

  async function downloadColumnFile(attachmentId: string) {
    const res = await getAttachmentDownloadUrl({ attachmentId });
    if (res.ok) window.open(res.data.url, "_blank", "noopener");
  }

  const toggleExpand = (id: string) =>
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(id)) {
        n.delete(id);
      } else {
        n.add(id);
      }
      return n;
    });

  const mutations = useBoardMutations(payload.board.id);
  // Board-level error surface for column-add failures. The Add-column menu is a
  // header dropdown with no inline spot, so failures (which were previously
  // swallowed silently) surface as a dismissible banner. Mirrors AddItemRow's
  // inline role="alert" pattern; the project has no toast primitive yet.
  const [columnError, setColumnError] = useState<string | null>(null);
  const {
    setCell,
    clearCellValue,
    addItem,
    renameItem: renameItemMutation,
    renameGroup,
    addGroup,
    setGroupColor,
    deleteGroup,
    reorderGroup,
    addSubitem,
    deleteItem,
    reorderItem,
  } = mutations;

  // Cell lookup keyed by `${item_id}:${column_id}` → raw JSON value.
  const cellMap = useMemo(() => buildCellMap(cellValues), [cellValues]);

  const { topLevel, childrenByParent } = useMemo(
    () => bucketItems(items),
    [items],
  );

  // Top-level items grouped by group_id, in position order.
  const itemsByGroup = useMemo(() => {
    const byGroup = new Map<string, typeof topLevel>();
    for (const g of groups) byGroup.set(g.id, []);
    for (const it of topLevel) {
      const bucket = byGroup.get(it.group_id);
      if (bucket) bucket.push(it);
      else byGroup.set(it.group_id, [it]);
    }
    return byGroup;
  }, [groups, topLevel]);

  // Filter / sort / quick-search state — read from the URL, applied to the
  // already-loaded cache in memory (0 server round-trips; see AGENTS.md
  // invariants / gotcha-09). Filtering narrows TOP-LEVEL rows only; subitems
  // still show under an expanded parent. Sorting reorders WITHIN each group so
  // group order (position) is preserved. Memoized so 5k rows aren't re-scanned
  // on unrelated re-renders (presence heartbeats) or per keystroke.
  const filter = useBoardFilterSort();
  const predicate = useMemo(
    () => buildItemPredicate(filter.state, { columns, cellMap }),
    [filter.state, columns, cellMap],
  );
  const comparator = useMemo(
    () => buildItemComparator(filter.state, { columns, cellMap }),
    [filter.state, columns, cellMap],
  );
  const { visibleItemsByGroup, visibleCount } = useMemo(() => {
    const out = new Map<string, Item[]>();
    let count = 0;
    for (const [gid, list] of itemsByGroup) {
      let next = list.filter(predicate);
      if (comparator) next = [...next].sort(comparator);
      out.set(gid, next);
      count += next.length;
    }
    return { visibleItemsByGroup: out, visibleCount: count };
  }, [itemsByGroup, predicate, comparator]);

  // Everything filtered away (a filter is active) → show a board-level empty
  // state instead of a wall of empty groups. Sort alone can't reduce the count,
  // so count 0 with items present means the predicate excluded them all.
  const filteredToEmpty = visibleCount === 0 && topLevel.length > 0;

  // ── Bulk row-selection wiring (ephemeral client state) ──────────────────────
  // Keep the store's ordered id list in sync with what's visible so a shift-click
  // range resolves across groups in display order, and clear the selection on
  // view change / unmount (selection is scoped to this mounted Table view).
  const setSelectionOrder = useBoardSelection((s) => s.setOrderedIds);
  const clearSelection = useBoardSelection((s) => s.clear);
  const orderedVisibleIds = useMemo(
    () =>
      groups.flatMap((g) =>
        (visibleItemsByGroup.get(g.id) ?? []).map((i) => i.id),
      ),
    [groups, visibleItemsByGroup],
  );
  useEffect(() => {
    setSelectionOrder(orderedVisibleIds);
  }, [orderedVisibleIds, setSelectionOrder]);
  useEffect(() => {
    clearSelection();
    return () => clearSelection();
  }, [selectedViewId, clearSelection]);

  const [liveWidths, setLiveWidths] = useState<Record<string, number>>({});

  // Offscreen canvas measurer at the Name cell font (Geist 14px / text-sm), used
  // to auto-fit the Name column to the longest item name across ALL items (not
  // just the virtualized rows). Pure measurement — no server round-trip.
  const measureName = useMemo(() => {
    const ctx =
      typeof document !== "undefined"
        ? document.createElement("canvas").getContext("2d")
        : null;
    if (ctx) ctx.font = "14px ui-sans-serif, system-ui, sans-serif";
    return (text: string) => ctx?.measureText(text).width ?? 0;
  }, []);
  const autoFitWidth = useMemo(
    () =>
      fitNameColumnWidth(
        items.map((it) => it.name),
        measureName,
      ),
    [items, measureName],
  );

  // null = follow board.name_column_width (or auto-fit). Set live during a drag.
  const [liveNameWidth, setLiveNameWidth] = useState<number | null>(null);
  const nameWidth = liveNameWidth ?? board.name_column_width ?? autoFitWidth;

  const template = useMemo(
    () => gridTemplate(columns, liveWidths, nameWidth),
    [columns, liveWidths, nameWidth],
  );

  // Viewers see footer values read-only; editors can pick the aggregation.
  const canEdit = access !== "viewer";
  // Snapshot now once at mount for time-tracking footer totals — a bare Date.now()
  // in render violates react-hooks/purity (same pattern as the rollup cells).
  const [footerNowMs] = useState(() => Date.now());

  // Persist a column's chosen footer aggregation into columns.settings jsonb
  // (migration-free). The update action replaces settings wholesale, so merge.
  function setColumnSummary(col: Column, agg: AggregationId | null) {
    const next = { ...((col.settings as Record<string, unknown>) ?? {}) };
    if (agg) next.summary_aggregation = agg;
    else delete next.summary_aggregation;
    mutations.updateColumnSettings(col.id, next);
  }

  // One shared bundle for every group's summary row (see GroupSummaryControls).
  const groupSummary: GroupSummaryControls = {
    canEdit,
    nowMs: footerNowMs,
    onChange: setColumnSummary,
  };

  // Board-level column-management surface shared by every group's header row
  // (columns are board-scoped). Width state stays here so a resize/add/rename
  // from any group reflows all groups + the footer.
  const columnControls: ColumnHeaderControls = {
    nameWidth,
    liveWidths,
    setLiveWidths,
    setLiveNameWidth,
    renameColumn: mutations.renameColumn,
    deleteColumn: mutations.deleteColumn,
    resizeColumn: mutations.resizeColumn,
    reorderColumn: mutations.reorderColumn,
    resizeNameColumn: mutations.resizeNameColumn,
    onAddColumn: (kind) => {
      if (kind === "relation") {
        setRelationTargetBoards([]);
        setRelationConfigOpen(true);
        listRelationTargetBoards().then(setRelationTargetBoards);
      } else if (kind === "mirror") {
        setMirrorConfigOpen(true);
      } else {
        setColumnError(null);
        mutations.addColumn(kind, undefined, {
          onError: (err) => setColumnError(err.message),
        });
      }
    },
    onEditOptions: (c) => setOptionsFor(c),
    onEditCurrency: (c) => setCurrencyFor(c),
  };

  const controls: CellControls = {
    editing,
    setEditing,
    setCell,
    clearCellValue,
    members,
    boardId: payload.board.id,
    currentUserId,
    addItem,
    renameItemInCache: renameItemMutation,
    addSubitem: (parentId, name, cbs) =>
      addSubitem(parentId, name, {
        onSuccess: (item) => cbs?.onSuccess?.(item.id),
        onError: cbs?.onError,
      }),
    deleteItem,
    reorderItem,
    cache,
    uploadColumnFile: mutations.uploadColumnFile,
    openFilesLightbox,
    startTimer: mutations.startTimer,
    stopTimer: mutations.stopTimer,
    addManualEntry: mutations.addManualEntry,
    editEntry: mutations.editEntry,
    deleteEntry: mutations.deleteEntry,
    setEstimate: mutations.setEstimate,
    setRelationLinks: mutations.setRelationLinks,
  };

  const sensors = useTouchAwareSensors();

  function handleGroupDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over) return;
    const position = reorderPosition(
      groups.map((g) => ({ id: g.id, position: g.position })),
      String(active.id),
      String(over.id),
    );
    if (position !== null) reorderGroup(String(active.id), position);
  }

  return (
    <div className="relative flex h-full flex-col">
      <BoardHeader
        boardId={board.id}
        boardName={board.name}
        views={payload.views}
        selectedViewId={selectedViewId}
        columns={columns}
        members={members}
        groups={groups.map((g) => ({ id: g.id, name: g.name }))}
        access={access}
        grants={grants}
        currentUserId={currentUserId}
        filterable
      />

      {columnError ? (
        <div
          role="alert"
          className="bg-surface flex items-center gap-2 border-b px-4 py-2"
        >
          <p className="text-destructive flex-1 text-sm">
            Couldn&apos;t add column: {columnError}
          </p>
          <button
            type="button"
            aria-label="Dismiss error"
            onClick={() => setColumnError(null)}
            className="text-muted-foreground hover:text-foreground hover:bg-accent flex size-6 shrink-0 items-center justify-center rounded-md"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ) : null}

      <div
        ref={scrollContainerRef}
        data-testid="board-scroll"
        data-scrolledx={scrolledX}
        onScroll={(e) => {
          const next = e.currentTarget.scrollLeft > 0;
          // setState bails out when unchanged, so this only re-renders on the
          // 0 ⇄ >0 boundary (cheap during scroll).
          setScrolledX(next);
        }}
        className="group/scroll flex-1 overflow-auto"
      >
        <div ref={contentRef} className="min-w-fit">
          {groups.length === 0 ? (
            <p className="text-muted-foreground px-4 py-6 text-sm">
              This board has no groups yet.
            </p>
          ) : filteredToEmpty ? (
            <EmptyState variant="inline" className="px-4 py-10">
              No items match your filters.{" "}
              <button
                type="button"
                onClick={filter.clearAll}
                className="text-foreground underline underline-offset-2"
              >
                Clear all
              </button>
            </EmptyState>
          ) : (
            <DndContext
              id="board-groups"
              sensors={sensors}
              modifiers={[restrictToVerticalAxis]}
              onDragEnd={handleGroupDragEnd}
            >
              <SortableContext
                items={groups.map((g) => g.id)}
                strategy={verticalListSortingStrategy}
              >
                {groups.map((group) => (
                  <GroupSection
                    key={group.id}
                    group={group}
                    items={visibleItemsByGroup.get(group.id) ?? []}
                    columns={columns}
                    selectable={canEdit}
                    col={columnControls}
                    cellMap={cellMap}
                    template={template}
                    controls={controls}
                    summary={groupSummary}
                    onRenameGroup={(name) => renameGroup(group.id, name)}
                    nameWidth={nameWidth}
                    autoFocusRename={group.id === renameGroupId}
                    onRenameSettled={() => setRenameGroupId(null)}
                    onSetColor={(color) => setGroupColor(group.id, color)}
                    onDelete={() => deleteGroup(group.id)}
                    childrenByParent={childrenByParent}
                    expanded={expanded}
                    onToggleExpand={toggleExpand}
                    renamingItemId={renamingItemId}
                    onRenameItemSettled={() => setRenamingItemId(null)}
                    onSetRenamingItemId={setRenamingItemId}
                    scrollContainerRef={scrollContainerRef}
                    contentRef={contentRef}
                  />
                ))}
              </SortableContext>
            </DndContext>
          )}
          <AddGroupRow
            onAdd={() =>
              // Naive count-based default name — user lands in rename mode, so a
              // collision after manual renames is cosmetic and immediately editable.
              addGroup(`Group ${groups.length + 1}`, {
                onSuccess: (groupId) => setRenameGroupId(groupId),
              })
            }
          />
          {columns.length > 0 && (
            <SummaryRow
              variant="board"
              testId="board-summary-footer"
              label="Total"
              columns={columns}
              itemIds={withSubitems(
                topLevel.map((it) => it.id),
                childrenByParent,
              )}
              cellMap={cellMap}
              cache={cache}
              template={template}
              nameWidth={nameWidth}
              canEdit={canEdit}
              nowMs={footerNowMs}
              onChange={setColumnSummary}
            />
          )}
        </div>
      </div>

      {optionsFor && (
        <ColumnOptionsDialog
          open
          column={optionsFor}
          usageOf={(optionId) =>
            countOptionUsage(cache.cellValues, optionsFor.id, optionId)
          }
          onSave={(settings) =>
            mutations.updateColumnSettings(optionsFor.id, settings)
          }
          onRemoveOption={(optionId) =>
            mutations.removeColumnOption(optionsFor.id, optionId)
          }
          onOpenChange={(o) => {
            if (!o) setOptionsFor(null);
          }}
        />
      )}

      <Dialog
        open={currencyFor !== null}
        onOpenChange={(open) => {
          if (!open) setCurrencyFor(null);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Change currency</DialogTitle>
            <DialogDescription>
              Pick the currency for “{currencyFor?.name}”.
            </DialogDescription>
          </DialogHeader>
          {currencyFor && (
            <CurrencyDialog
              column={currencyFor}
              onSave={(settings) => {
                mutations.updateColumnSettings(currencyFor.id, settings);
                setCurrencyFor(null);
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={relationConfigOpen} onOpenChange={setRelationConfigOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Connect boards</DialogTitle>
            <DialogDescription>
              Pick the board this column links items to.
            </DialogDescription>
          </DialogHeader>
          <RelationColumnConfig
            boards={relationTargetBoards.filter((b) => b.id !== board.id)}
            onConfirm={(settings) => {
              setColumnError(null);
              mutations.addColumn("relation", settings, {
                onError: (err) => setColumnError(err.message),
              });
              setRelationConfigOpen(false);
            }}
            onCancel={() => setRelationConfigOpen(false)}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={mirrorConfigOpen} onOpenChange={setMirrorConfigOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Mirror a column</DialogTitle>
            <DialogDescription>
              Reflect a field from a board you&apos;re connected to through a
              relation column.
            </DialogDescription>
          </DialogHeader>
          <MirrorColumnConfig
            relationColumns={columns
              .filter((c) => c.kind === "relation")
              .map((c) => ({
                id: c.id,
                name: c.name,
                target_board_id:
                  ((c.settings ?? {}) as { target_board_id?: string })
                    .target_board_id ?? "",
              }))}
            loadTargetColumns={(targetBoardId) =>
              listMirrorableColumns(targetBoardId)
            }
            onConfirm={(settings) => {
              setColumnError(null);
              mutations.addColumn("mirror", settings, {
                onError: (err) => setColumnError(err.message),
              });
              setMirrorConfigOpen(false);
            }}
            onCancel={() => setMirrorConfigOpen(false)}
          />
        </DialogContent>
      </Dialog>

      {filesLightbox && (
        <FilePreviewLightbox
          attachments={filesLightbox.files}
          index={filesLightbox.index}
          previewUrls={filesPreviewUrls}
          currentUserId={currentUserId}
          onIndexChange={(i) =>
            setFilesLightbox((s) => (s ? { ...s, index: i } : s))
          }
          onClose={() => setFilesLightbox(null)}
          onDownload={(a) => downloadColumnFile(a.id)}
          onDelete={(a) => {
            mutations.deleteColumnFile(a.id);
            setFilesLightbox(null);
          }}
        />
      )}

      {canEdit && (
        <BoardBulkBar
          boardId={board.id}
          groups={groups.map((g) => ({ id: g.id, name: g.name }))}
          columns={columns}
          members={members}
        />
      )}
    </div>
  );
}

/**
 * Header for the built-in Name column: a sticky "Name" label plus a right-edge
 * resize handle that mirrors {@link ColumnHeader}. Drag resizes live (0 server
 * round-trips) and persists the px width on release; double-clicking the handle
 * clears the manual width so the column returns to auto-fit.
 */
/**
 * The Name-column resize separator (drag to resize, double-click to auto-fit).
 * Lives on the right edge of each group header's frozen Name cell. Extracted
 * from the old global header's NameColumnHeader so every group can resize the
 * shared Name column.
 */
function NameResizeHandle({
  width,
  onResize,
  onResizeEnd,
  onAutoFit,
}: {
  width: number;
  onResize: (w: number) => void;
  onResizeEnd: (w: number) => void;
  onAutoFit: () => void;
}) {
  // Coalesce per-pixel live-width updates to one state update per frame so the
  // drag stays smooth; the persist-on-release path (onResizeEnd) is unchanged.
  const throttledResize = useRafCallback(onResize);

  function onPointerDown(e: React.PointerEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    let last = width;
    const move = (ev: PointerEvent) => {
      last = clampDragWidth(
        startW + (ev.clientX - startX),
        NAME_DRAG_MIN,
        NAME_COL_MAX,
      );
      throttledResize(last);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      onResizeEnd(last);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize Name column (double-click to auto-fit)"
      onPointerDown={onPointerDown}
      onDoubleClick={onAutoFit}
      className="hover:bg-primary/40 absolute top-0 right-0 h-full w-1 cursor-col-resize"
    />
  );
}

function GroupMenu({
  group,
  onRename,
  onSetColor,
  onDelete,
}: {
  group: Group;
  onRename: () => void;
  onSetColor: (color: string) => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`${group.name} group menu`}
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring ml-auto grid size-7 shrink-0 place-items-center rounded-md opacity-0 transition-opacity group-hover/grouphdr:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:outline-none pointer-coarse:size-11 pointer-coarse:opacity-100"
          >
            <MoreHorizontal className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onSelect={onRename}>Rename</DropdownMenuItem>
          <DropdownMenuSeparator />
          <div className="px-2 py-1.5">
            <p className="text-muted-foreground mb-1.5 text-xs">Color</p>
            <div className="grid grid-cols-6 gap-1.5">
              {GROUP_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Set color ${c}`}
                  onClick={() => {
                    onSetColor(c);
                    setOpen(false);
                  }}
                  style={{ backgroundColor: c }}
                  className={cn(
                    "focus-visible:ring-ring size-5 rounded-full focus-visible:ring-2 focus-visible:outline-none",
                    group.color.toLowerCase() === c.toLowerCase() &&
                      "ring-foreground ring-offset-background ring-2 ring-offset-1",
                  )}
                />
              ))}
            </div>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive"
            onSelect={() => setConfirming(true)}
          >
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete &ldquo;{group.name}&rdquo;?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the group and all of its items on this
              board. This can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90 text-white"
              onClick={onDelete}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** Row ⋯ menu: Delete with an AlertDialog confirm for parents-with-children. */
function RowMenu({
  label,
  hasChildren,
  onDelete,
}: {
  label: string;
  hasChildren: boolean;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`${label} menu`}
            className="text-muted-foreground hover:text-foreground grid size-7 shrink-0 place-items-center rounded-md opacity-0 transition-opacity group-hover/name:opacity-100 focus-visible:opacity-100 pointer-coarse:size-11 pointer-coarse:opacity-100"
          >
            <MoreHorizontal className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem
            className="text-destructive"
            onSelect={() => (hasChildren ? setConfirming(true) : onDelete())}
          >
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete &ldquo;{label}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the item and all of its subitems. This
              can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90 text-white"
              onClick={onDelete}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** Read-only static header cell for the two virtual creation-metadata columns. */
function CreatedHeaderCell({
  icon: Icon,
  label,
}: {
  icon: typeof User;
  label: string;
}) {
  return (
    <div className="text-muted-foreground flex items-center gap-1.5 border-l px-3 text-xs font-medium opacity-60">
      <Icon className="size-3.5" />
      <span className="truncate">{label}</span>
    </div>
  );
}

/** Owns useSortable for one data-column header so ColumnHeader stays
 *  presentational. Translate-only transform (gotcha-20: grid tracks have
 *  differing widths — never stretch). */
function SortableColumnHeader({
  column,
  col,
  onMoveLeft,
  onMoveRight,
}: {
  column: Column;
  col: ColumnHeaderControls;
  onMoveLeft: (() => void) | null;
  onMoveRight: (() => void) | null;
}) {
  const {
    setNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: column.id });
  return (
    <ColumnHeader
      column={column}
      width={col.liveWidths[column.id] ?? column.width ?? VALUE_COL_WIDTH}
      onRename={(n) => col.renameColumn(column.id, n)}
      onDelete={() => col.deleteColumn(column.id)}
      onResize={(w) => col.setLiveWidths((m) => ({ ...m, [column.id]: w }))}
      onResizeEnd={(w) => col.resizeColumn(column.id, w)}
      onEditOptions={() => col.onEditOptions(column)}
      onEditCurrency={() => col.onEditCurrency(column)}
      reorder={{
        setNodeRef,
        style: {
          transform: CSS.Translate.toString(transform),
          transition,
        },
        isDragging,
        handleAttributes: attributes,
        handleListeners: listeners,
        onMoveLeft,
        onMoveRight,
      }}
    />
  );
}

/**
 * A group's header row (Monday-style): a grid aligned to the shared column
 * `template`, with the group controls in a frozen Name cell and an interactive
 * {@link ColumnHeader} per board column + {@link AddColumnMenu}. Rendered by
 * EVERY group (there is no single global header), so empty/new groups still
 * show the board's columns. Column width/options/dialog state is shared via
 * {@link ColumnHeaderControls} so a change from any group reflows all groups.
 */
function GroupHeaderRow({
  group,
  columns,
  template,
  selectAll,
  collapsed,
  onToggleCollapse,
  renaming,
  name,
  onNameChange,
  onCommitRename,
  onCancelRename,
  onOpenRename,
  itemCount,
  dragAttributes,
  dragListeners,
  onSetColor,
  onDelete,
  col,
}: {
  group: Group;
  columns: Column[];
  template: string;
  /** Group-header "select all visible" checkbox, or null for viewers/empty groups. */
  selectAll: React.ReactNode;
  collapsed: boolean;
  onToggleCollapse: () => void;
  renaming: boolean;
  name: string;
  onNameChange: (v: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onOpenRename: () => void;
  itemCount: number;
  dragAttributes: ReturnType<typeof useSortable>["attributes"];
  dragListeners: ReturnType<typeof useSortable>["listeners"];
  onSetColor: (color: string) => void;
  onDelete: () => void;
  col: ColumnHeaderControls;
}) {
  const columnSensors = useTouchAwareSensors();

  function columnMovePosition(index: number, dir: -1 | 1): number | null {
    const over = columns[index + dir];
    if (!over) return null;
    return reorderPosition(
      columns.map((c) => ({ id: c.id, position: c.position })),
      columns[index].id,
      over.id,
    );
  }

  function handleColumnDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const position = reorderPosition(
      columns.map((c) => ({ id: c.id, position: c.position })),
      String(active.id),
      String(over.id),
    );
    if (position !== null) col.reorderColumn(String(active.id), position);
  }

  return (
    <div
      className="group/grouphdr bg-surface text-muted-foreground grid border-b text-xs font-medium"
      style={{ gridTemplateColumns: template }}
    >
      {/* Frozen group/Name cell — group controls + Name-column resize handle. */}
      <div
        className={cn(
          "bg-surface text-foreground relative sticky left-0 z-10 flex items-center gap-2 px-3 py-1.5 text-sm font-semibold",
          NAME_FREEZE_EDGE,
        )}
        style={{ boxShadow: `inset 3px 0 0 0 ${group.color}` }}
      >
        {selectAll}
        <button
          type="button"
          aria-label={`Reorder ${group.name}`}
          {...dragAttributes}
          {...dragListeners}
          className="text-muted-foreground hover:text-foreground grid size-7 shrink-0 cursor-grab touch-none place-items-center rounded-md opacity-0 transition-opacity group-hover/grouphdr:opacity-100 active:cursor-grabbing pointer-coarse:size-11 pointer-coarse:opacity-100"
        >
          <GripVertical className="size-4" />
        </button>
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? "Expand" : "Collapse"} ${group.name}`}
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring grid size-7 shrink-0 place-items-center rounded-md focus-visible:ring-2 focus-visible:outline-none"
        >
          {collapsed ? (
            <ChevronRight className="size-4" />
          ) : (
            <ChevronDown className="size-4" />
          )}
        </button>
        <span
          className="inline-block size-2 shrink-0 rounded-full"
          style={{ backgroundColor: group.color }}
          aria-hidden
        />
        {renaming ? (
          <Input
            autoFocus
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            onBlur={onCommitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onCommitRename();
              } else if (e.key === "Escape") {
                e.preventDefault();
                onCancelRename();
              }
            }}
            aria-label={`Rename ${group.name}`}
            className="h-7 max-w-xs"
          />
        ) : (
          <button
            type="button"
            onClick={onOpenRename}
            className="focus-visible:ring-ring min-w-0 truncate rounded-sm text-left focus-visible:ring-2 focus-visible:outline-none"
          >
            {group.name}
          </button>
        )}
        <span className="text-muted-foreground text-xs font-normal">
          {itemCount}
        </span>
        <GroupMenu
          group={group}
          onRename={onOpenRename}
          onSetColor={onSetColor}
          onDelete={onDelete}
        />
        <NameResizeHandle
          width={col.nameWidth}
          onResize={(w) => col.setLiveNameWidth(w)}
          onResizeEnd={(w) => {
            col.setLiveNameWidth(null);
            col.resizeNameColumn(w);
          }}
          onAutoFit={() => {
            col.setLiveNameWidth(null);
            col.resizeNameColumn(null);
          }}
        />
      </div>

      {/* DndContext/SortableContext render no DOM, so headers stay direct
          grid children. The frozen Name cell before this block and the
          Created/Add cells after it sit OUTSIDE the sortable set — that is
          what makes the Name column immovable by construction. */}
      <DndContext
        id={`group-columns-${group.id}`}
        sensors={columnSensors}
        modifiers={[restrictToHorizontalAxis]}
        onDragEnd={handleColumnDragEnd}
      >
        <SortableContext
          items={columns.map((c) => c.id)}
          strategy={horizontalListSortingStrategy}
        >
          {columns.map((c, i) => (
            <SortableColumnHeader
              key={c.id}
              column={c}
              col={col}
              onMoveLeft={
                i > 0
                  ? () => {
                      const p = columnMovePosition(i, -1);
                      if (p !== null) col.reorderColumn(c.id, p);
                    }
                  : null
              }
              onMoveRight={
                i < columns.length - 1
                  ? () => {
                      const p = columnMovePosition(i, 1);
                      if (p !== null) col.reorderColumn(c.id, p);
                    }
                  : null
              }
            />
          ))}
        </SortableContext>
      </DndContext>
      <CreatedHeaderCell icon={User} label="Created by" />
      <CreatedHeaderCell icon={Clock} label="Created at" />
      <AddColumnMenu onAdd={col.onAddColumn} />
    </div>
  );
}

/**
 * Read-only per-column rollup row shown under a collapsed group's header, so a
 * collapsed group summarizes all its items the same way a collapsed parent
 * summarizes its subitems (percent → averaged color bar, number → sum, etc.).
 * Computed client-side from already-loaded cell values — no extra round-trips.
 */
function GroupRollupRow({
  group,
  items,
  columns,
  cellMap,
  cache,
  template,
}: {
  group: Group;
  items: Item[];
  columns: Column[];
  cellMap: Map<string, CacheCellValue["value"]>;
  cache: BoardCache;
  template: string;
}) {
  // Snapshot "now" for any running time-tracking entry (keeps render pure).
  const [nowMs] = useState(() => Date.now());
  return (
    <div
      className="bg-surface grid w-full border-b"
      style={{ height: ROW_HEIGHT, gridTemplateColumns: template }}
    >
      <div
        className={cn(
          "bg-surface text-muted-foreground sticky left-0 z-10 flex items-center px-3 text-xs",
          NAME_FREEZE_EDGE,
        )}
        style={{ boxShadow: `inset 3px 0 0 0 ${group.color}` }}
      >
        Average
      </div>
      {columns.map((col) => (
        <RollupValueCell
          key={col.id}
          col={col}
          items={items}
          cellMap={cellMap}
          cache={cache}
          nowMs={nowMs}
        />
      ))}
      {/* Two filler cells to keep the grid aligned with the created-by/created-at tracks */}
      <div aria-hidden />
      <div aria-hidden />
    </div>
  );
}

function GroupSection({
  group,
  items,
  columns,
  selectable,
  col,
  cellMap,
  template,
  controls,
  summary,
  onRenameGroup,
  nameWidth,
  autoFocusRename,
  onRenameSettled,
  onSetColor,
  onDelete,
  childrenByParent,
  expanded,
  onToggleExpand,
  renamingItemId,
  onRenameItemSettled,
  onSetRenamingItemId,
  scrollContainerRef,
  contentRef,
}: {
  group: Group;
  items: Item[];
  columns: Column[];
  /** Whether bulk row-selection checkboxes are shown (editors only, not viewers). */
  selectable: boolean;
  col: ColumnHeaderControls;
  cellMap: Map<string, CacheCellValue["value"]>;
  template: string;
  controls: CellControls;
  summary: GroupSummaryControls;
  onRenameGroup: (name: string) => void;
  nameWidth: number;
  autoFocusRename: boolean;
  onRenameSettled: () => void;
  onSetColor: (color: string) => void;
  onDelete: () => void;
  childrenByParent: Map<string, Item[]>;
  expanded: Set<string>;
  onToggleExpand: (id: string) => void;
  renamingItemId: string | null;
  onRenameItemSettled: () => void;
  onSetRenamingItemId: (id: string) => void;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  contentRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [renaming, setRenaming] = useState(autoFocusRename);
  const [name, setName] = useState(group.name);
  const rowAreaRef = useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  // The shared scroll container is owned by the parent (BoardTable); during this
  // child's first commit the parent's ref isn't attached yet, so the virtualizer
  // reads a null scroll element and yields 0 rows. A passive effect populates the
  // ref, then flips `scrollReady` once to force a single extra render so the
  // virtualizer re-runs getScrollElement and binds the now-mounted container.
  // Value is intentionally unused — the state write forces one re-render so the
  // virtualizer re-runs getScrollElement once the parent ref is attached.
  const [scrollReady, setScrollReady] = useState(false);

  useEffect(() => {
    if (!scrollReady && scrollContainerRef.current) setScrollReady(true);
  }, [scrollReady, scrollContainerRef]);

  // The group's row-area offset within the shared scroll content. Re-measured
  // whenever the content height changes (any group expand/collapse/add/remove)
  // and on every render (covers DnD reorder, which shifts offsets without
  // changing total height). Guarded setState avoids a layout-effect loop.
  useIsoLayoutEffect(() => {
    const measure = () => {
      const area = rowAreaRef.current;
      const scroller = scrollContainerRef.current;
      if (!area || !scroller) return;
      const top =
        area.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top +
        scroller.scrollTop;
      setScrollMargin((prev) => (prev === top ? prev : top));
    };
    measure();
    const content = contentRef.current;
    if (!content) return;
    const ro = new ResizeObserver(measure);
    ro.observe(content);
    return () => ro.disconnect();
  });

  const {
    setNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: group.id });

  const itemSensors = useTouchAwareSensors();

  function handleItemDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const position = reorderPosition(
      items.map((i) => ({ id: i.id, position: i.position })),
      String(active.id),
      String(over.id),
    );
    if (position !== null) controls.reorderItem(String(active.id), position);
  }

  // React Compiler safely skips memoizing this component because useVirtualizer
  // returns non-memoizable functions; that fallback is correct here.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollContainerRef.current,
    scrollMargin,
    estimateSize: () => ROW_HEIGHT,
    overscan: 6,
    // getBoundingClientRect().height returns 0 in jsdom — fall back to ROW_HEIGHT
    // so tests don't collapse all virtual rows to 0px height.
    measureElement: (el) => el.getBoundingClientRect().height || ROW_HEIGHT,
  });

  const virtualRows = virtualizer.getVirtualItems();

  function openRename() {
    setName(group.name);
    setRenaming(true);
  }

  function commitRename() {
    const trimmed = name.trim();
    setRenaming(false);
    onRenameSettled();
    if (!trimmed || trimmed === group.name) return;
    onRenameGroup(trimmed);
  }

  return (
    // Translate only (no scale): CSS.Transform emits dnd-kit's scaleX/scaleY,
    // which — with variable-height groups — stretches the absolutely-positioned
    // virtual rows. Mirrors KanbanCard's translate3d-only drag transform.
    <section
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(isDragging && "relative z-20 shadow-lg")}
    >
      <GroupHeaderRow
        group={group}
        columns={columns}
        template={template}
        selectAll={
          selectable && items.length > 0 ? (
            <GroupSelectAllCheckbox visibleIds={items.map((i) => i.id)} />
          ) : null
        }
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed((c) => !c)}
        renaming={renaming}
        name={name}
        onNameChange={setName}
        onCommitRename={commitRename}
        onCancelRename={() => {
          setRenaming(false);
          onRenameSettled();
        }}
        onOpenRename={openRename}
        itemCount={items.length}
        dragAttributes={attributes}
        dragListeners={listeners}
        onSetColor={onSetColor}
        onDelete={onDelete}
        col={col}
      />

      {/* Collapsed strip: the user's assigned aggregation wins; the legacy
          hardcoded rollup remains the byte-for-byte fallback (spec D5). */}
      {collapsed &&
        items.length > 0 &&
        (hasAssignedSummary(columns) ? (
          <SummaryRow
            variant="group"
            testId={`group-summary-${group.id}`}
            label="Group Summary"
            groupColor={group.color}
            columns={columns}
            itemIds={withSubitems(
              items.map((i) => i.id),
              childrenByParent,
            )}
            cellMap={cellMap}
            cache={controls.cache}
            template={template}
            nameWidth={nameWidth}
            canEdit={summary.canEdit}
            nowMs={summary.nowMs}
            onChange={summary.onChange}
          />
        ) : (
          <GroupRollupRow
            group={group}
            items={items}
            columns={columns}
            cellMap={cellMap}
            cache={controls.cache}
            template={template}
          />
        ))}

      {!collapsed && (
        <>
          {items.length > 0 && (
            <DndContext
              id={`group-items-${group.id}`}
              sensors={itemSensors}
              modifiers={[restrictToVerticalAxis]}
              onDragEnd={handleItemDragEnd}
            >
              <SortableContext
                items={items.map((i) => i.id)}
                strategy={verticalListSortingStrategy}
              >
                <div
                  ref={rowAreaRef}
                  data-testid={`group-rows-${group.id}`}
                  className="relative"
                  style={{ height: virtualizer.getTotalSize() }}
                >
                  {virtualRows.map((vr) => {
                    const item = items[vr.index];
                    const children = childrenByParent.get(item.id) ?? [];
                    const isExpanded = expanded.has(item.id);
                    return (
                      <div
                        key={item.id}
                        data-index={vr.index}
                        ref={virtualizer.measureElement}
                        className="absolute top-0 left-0 w-full"
                        style={{
                          transform: `translateY(${vr.start - scrollMargin}px)`,
                        }}
                      >
                        <ItemRow
                          item={item}
                          columns={columns}
                          cellMap={cellMap}
                          template={template}
                          controls={controls}
                          selectable={selectable}
                          subitems={children}
                          childCount={children.length}
                          isExpanded={isExpanded}
                          onToggle={() => onToggleExpand(item.id)}
                          autoFocusRename={item.id === renamingItemId}
                          onRenameSettled={onRenameItemSettled}
                          onSubitemAdded={onSetRenamingItemId}
                        />
                        {isExpanded && children.length > 0 && (
                          <SubitemBlock
                            parentId={item.id}
                            subitems={children}
                            columns={columns}
                            cellMap={cellMap}
                            template={template}
                            controls={controls}
                            renamingItemId={renamingItemId}
                            onRenameSettled={onRenameItemSettled}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </SortableContext>
            </DndContext>
          )}
          <AddItemRow
            groupId={group.id}
            controls={controls}
            nameWidth={nameWidth}
          />
          {hasAssignedSummary(columns) && (
            <SummaryRow
              variant="group"
              testId={`group-summary-${group.id}`}
              label="Group Summary"
              groupColor={group.color}
              columns={columns}
              itemIds={withSubitems(
                items.map((i) => i.id),
                childrenByParent,
              )}
              cellMap={cellMap}
              cache={controls.cache}
              template={template}
              nameWidth={nameWidth}
              canEdit={summary.canEdit}
              nowMs={summary.nowMs}
              onChange={summary.onChange}
            />
          )}
        </>
      )}
    </section>
  );
}

/** A single top-level item row: optional expand chevron, name, value cells. */
function ItemRow({
  item,
  columns,
  cellMap,
  template,
  controls,
  selectable,
  subitems,
  childCount,
  isExpanded,
  onToggle,
  autoFocusRename,
  onRenameSettled,
  onSubitemAdded,
}: {
  item: Item;
  columns: Column[];
  cellMap: Map<string, CacheCellValue["value"]>;
  template: string;
  controls: CellControls;
  /** Whether the bulk-select checkbox is shown (editors only). */
  selectable: boolean;
  subitems: Item[];
  childCount: number;
  isExpanded: boolean;
  onToggle: () => void;
  autoFocusRename: boolean;
  onRenameSettled: () => void;
  onSubitemAdded?: (id: string) => void;
}) {
  // Collapsed-parent time rollup needs a "now" for any running child entry, but
  // a bare Date.now() in render violates react-hooks/purity. Snapshot it at mount
  // via a lazy initializer (same idiom as TimeTrackingCell): the Σ of a running
  // child's elapsed time is approximate while collapsed — the live tick happens in
  // the expanded child cell — and it refreshes whenever this (virtualized) row remounts.
  const [rollupNowMs] = useState(() => Date.now());
  // Viewer-local "today" for the overdue tint, snapshotted at row mount (same
  // purity idiom as rollupNowMs; virtualized rows remount as they scroll).
  const [todayISO] = useState(() => localTodayISO());
  // Priority cells only: direct-dependent counts derived from the cached
  // dependency edges (one O(E) pass — see @/lib/boards/priority; overdue-tint
  // precedent: render-time signal, nothing persisted, 0 extra round-trips).
  const dependentsByItem = useMemo(
    () => buildDependentsCountMap(controls.cache.dependencies),
    [controls.cache.dependencies],
  );
  const {
    setNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const dragHandle = (
    <button
      type="button"
      aria-label={`Reorder ${item.name}`}
      {...attributes}
      {...listeners}
      className="text-muted-foreground hover:text-foreground grid size-6 shrink-0 cursor-grab touch-none place-items-center rounded opacity-0 transition-opacity group-hover/name:opacity-100 active:cursor-grabbing pointer-coarse:size-11 pointer-coarse:opacity-100"
    >
      <GripVertical className="size-3.5" />
    </button>
  );

  const chevron =
    childCount > 0 ? (
      <>
        <button
          type="button"
          aria-label={`${isExpanded ? "Collapse" : "Expand"} ${item.name}`}
          aria-expanded={isExpanded}
          onClick={onToggle}
          className="text-muted-foreground hover:text-foreground grid size-6 shrink-0 place-items-center rounded"
        >
          {isExpanded ? (
            <ChevronDown className="size-3.5" />
          ) : (
            <ChevronRight className="size-3.5" />
          )}
        </button>
        <span className="text-muted-foreground ml-1 text-xs">
          ({childCount})
        </span>
      </>
    ) : (
      // Spacer to keep name text aligned
      <span className="inline-block size-6 shrink-0" aria-hidden />
    );

  const trailing = (
    <>
      {childCount === 0 && (
        <button
          type="button"
          aria-label={`Add subitem to ${item.name}`}
          onClick={() =>
            controls.addSubitem(item.id, "New subitem", {
              onSuccess: (id) => {
                // Expand the parent so the new subitem is visible, then
                // enter rename mode on it.
                if (!isExpanded) onToggle();
                onSubitemAdded?.(id);
              },
            })
          }
          className="text-muted-foreground hover:text-foreground grid size-7 shrink-0 place-items-center rounded-md opacity-0 transition-opacity group-hover/name:opacity-100 focus-visible:opacity-100 pointer-coarse:size-11 pointer-coarse:opacity-100"
        >
          <Plus className="size-3.5" />
        </button>
      )}
      <RowMenu
        label={item.name}
        hasChildren={childCount > 0}
        onDelete={() => controls.deleteItem(item.id)}
      />
    </>
  );

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "hover:bg-surface grid w-full border-b transition-colors",
        isDragging && "relative z-10 shadow-lg",
      )}
      style={{
        height: ROW_HEIGHT,
        gridTemplateColumns: template,
        transform: CSS.Translate.toString(transform),
        transition,
      }}
    >
      <NameCell
        item={item}
        controls={controls}
        leading={
          <>
            {selectable && (
              <RowSelectCheckbox itemId={item.id} name={item.name} />
            )}
            {dragHandle}
            {chevron}
          </>
        }
        trailing={trailing}
        autoFocusRename={autoFocusRename}
        onRenameSettled={onRenameSettled}
      />
      {columns.map((col) => {
        if (childCount > 0 && !isExpanded) {
          return (
            <RollupValueCell
              key={col.id}
              col={col}
              items={subitems}
              cellMap={cellMap}
              cache={controls.cache}
              nowMs={rollupNowMs}
            />
          );
        }
        const value = cellMap.get(cellKey(item.id, col.id)) ?? null;
        return (
          <EditableCell
            key={col.id}
            item={item}
            column={col}
            value={value}
            controls={controls}
            overdue={
              col.kind === "date" &&
              isOverdue(value, todayISO) &&
              !isItemComplete(item.id, columns, controls.cache.cellValues)
            }
            dependents={
              col.kind === "priority"
                ? (dependentsByItem.get(item.id) ?? 0)
                : undefined
            }
          />
        );
      })}
      {/* Virtual created-by / created-at trailing cells */}
      {(() => {
        const creator = controls.members.find(
          (m) => m.userId === item.created_by,
        );
        return (
          <>
            <div className="flex h-full items-center border-l px-3">
              <CreatedByCell
                name={creator?.fullName ?? creator?.email ?? null}
                avatarUrl={creator?.avatarUrl ?? null}
              />
            </div>
            <div className="flex h-full items-center border-l px-3">
              <CreatedAtCell iso={item.created_at} />
            </div>
          </>
        );
      })()}
      <div aria-hidden /> {/* add-column track spacer */}
    </div>
  );
}

/** A single sortable subitem row inside a `SubitemBlock`. */
function SortableSubitemRow({
  sub,
  columns,
  cellMap,
  template,
  controls,
  renamingItemId,
  onRenameSettled,
}: {
  sub: Item;
  columns: Column[];
  cellMap: Map<string, CacheCellValue["value"]>;
  template: string;
  controls: CellControls;
  renamingItemId: string | null;
  onRenameSettled: () => void;
}) {
  // Viewer-local "today" for the overdue tint, snapshotted at row mount (same
  // purity idiom as ItemRow's rollupNowMs).
  const [todayISO] = useState(() => localTodayISO());
  // Priority cells only: direct-dependent counts (see ItemRow's map).
  const dependentsByItem = useMemo(
    () => buildDependentsCountMap(controls.cache.dependencies),
    [controls.cache.dependencies],
  );
  const {
    setNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: sub.id });

  const dragHandle = (
    <button
      type="button"
      aria-label={`Reorder ${sub.name}`}
      {...attributes}
      {...listeners}
      className="text-muted-foreground hover:text-foreground grid size-6 shrink-0 cursor-grab touch-none place-items-center rounded opacity-0 transition-opacity group-hover/name:opacity-100 active:cursor-grabbing pointer-coarse:size-11 pointer-coarse:opacity-100"
    >
      <GripVertical className="size-3.5" />
    </button>
  );

  return (
    <div
      ref={setNodeRef}
      style={{
        // CSS.Translate (not CSS.Transform) — drops the scale so variable-height
        // rows don't stretch/squish during drag (gotcha-20).
        transform: CSS.Translate.toString(transform),
        transition,
        height: ROW_HEIGHT,
        gridTemplateColumns: template,
      }}
      className={cn(
        "hover:bg-surface grid w-full border-b transition-colors",
        isDragging && "relative z-10 shadow-lg",
      )}
    >
      <NameCell
        item={sub}
        controls={controls}
        leading={dragHandle}
        indented
        autoFocusRename={sub.id === renamingItemId}
        onRenameSettled={onRenameSettled}
        trailing={
          <RowMenu
            label={sub.name}
            hasChildren={false}
            onDelete={() => controls.deleteItem(sub.id)}
          />
        }
      />
      {columns.map((col) => {
        const value = cellMap.get(cellKey(sub.id, col.id)) ?? null;
        return (
          <EditableCell
            key={col.id}
            item={sub}
            column={col}
            value={value}
            controls={controls}
            overdue={
              col.kind === "date" &&
              isOverdue(value, todayISO) &&
              !isItemComplete(sub.id, columns, controls.cache.cellValues)
            }
            dependents={
              col.kind === "priority"
                ? (dependentsByItem.get(sub.id) ?? 0)
                : undefined
            }
          />
        );
      })}
      {/* Virtual created-by / created-at trailing cells */}
      {(() => {
        const creator = controls.members.find(
          (m) => m.userId === sub.created_by,
        );
        return (
          <>
            <div className="flex h-full items-center border-l px-3">
              <CreatedByCell
                name={creator?.fullName ?? creator?.email ?? null}
                avatarUrl={creator?.avatarUrl ?? null}
              />
            </div>
            <div className="flex h-full items-center border-l px-3">
              <CreatedAtCell iso={sub.created_at} />
            </div>
          </>
        );
      })()}
      <div aria-hidden />
    </div>
  );
}

/** An indented block of subitems rendered below their expanded parent. */
function SubitemBlock({
  parentId,
  subitems,
  columns,
  cellMap,
  template,
  controls,
  renamingItemId,
  onRenameSettled,
}: {
  parentId: string;
  subitems: Item[];
  columns: Column[];
  cellMap: Map<string, CacheCellValue["value"]>;
  template: string;
  controls: CellControls;
  renamingItemId: string | null;
  onRenameSettled: () => void;
}) {
  const subitemSensors = useTouchAwareSensors();

  function handleSubitemDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const position = reorderPosition(
      subitems.map((s) => ({ id: s.id, position: s.position })),
      String(active.id),
      String(over.id),
    );
    if (position !== null) controls.reorderItem(String(active.id), position);
  }

  return (
    // Recessed band so the nested subitems read as visually distinct from
    // top-level item rows and the parent-level "Add item" row below them.
    <div className="bg-surface-sunken">
      <DndContext
        id={`subitems-${parentId}`}
        sensors={subitemSensors}
        modifiers={[restrictToVerticalAxis]}
        onDragEnd={handleSubitemDragEnd}
      >
        <SortableContext
          items={subitems.map((s) => s.id)}
          strategy={verticalListSortingStrategy}
        >
          {subitems.map((sub) => (
            <SortableSubitemRow
              key={sub.id}
              sub={sub}
              columns={columns}
              cellMap={cellMap}
              template={template}
              controls={controls}
              renamingItemId={renamingItemId}
              onRenameSettled={onRenameSettled}
            />
          ))}
        </SortableContext>
      </DndContext>
      <AddSubitemRow parentId={parentId} controls={controls} />
    </div>
  );
}

/** Inline input row appended to the expanded subitem block. */
function AddSubitemRow({
  parentId,
  controls,
}: {
  parentId: string;
  controls: CellControls;
}) {
  const [name, setName] = useState("");
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  // After a successful add, refocus this input so the user can type the next
  // subitem and commit it with Enter alone. The input is disabled mid-flight
  // (which blurs it), so we wait for the transition to settle before refocusing.
  const refocusAfterAdd = useRef(false);
  useEffect(() => {
    if (!isPending && refocusAfterAdd.current) {
      refocusAfterAdd.current = false;
      inputRef.current?.focus();
    }
  }, [isPending]);
  function commit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    startTransition(() =>
      controls.addSubitem(parentId, trimmed, {
        onSuccess: () => {
          // The name is already set from what the user typed — do NOT drop the
          // new row into rename mode (that required a second Enter to dismiss).
          setName("");
          refocusAfterAdd.current = true;
        },
      }),
    );
  }
  return (
    <div className="bg-surface-sunken sticky left-0 flex items-center gap-2 border-b py-1.5 pr-4 pl-12">
      <Plus className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
      <input
        ref={inputRef}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
        }}
        disabled={isPending}
        placeholder="Add subitem"
        aria-label="Add subitem"
        className="text-foreground placeholder:text-muted-foreground w-full bg-transparent text-sm outline-none disabled:opacity-50"
      />
    </div>
  );
}

/**
 * One configurable-column cell. Resting state renders the read-only
 * `CellRenderer` wrapped in a click/Enter-to-edit affordance; when active it
 * swaps to the kind's `CellEditor`. Commits write through `setCell`
 * (optimistically); an explicit clear (Status "Clear", emptied number/date,
 * empty multi-select) routes through `clearCellValue`, which deletes the row.
 */
function EditableCell({
  item,
  column,
  value,
  controls,
  overdue = false,
  dependents,
}: {
  item: Item;
  column: Column;
  value: CacheCellValue["value"];
  controls: CellControls;
  /** Date cells only: past-due + incomplete (see @/lib/boards/overdue). */
  overdue?: boolean;
  /** Priority cells only: direct dependents of the item — see @/lib/boards/priority. */
  dependents?: number;
}) {
  const { editing, setEditing, setCell, clearCellValue, members } = controls;
  const isEditing =
    editing?.itemId === item.id && editing.columnId === column.id;
  const settings = (column.settings ?? {}) as Settings;
  const accessibleName = `${item.name} ${column.name}`;
  const target = presenceTarget.cell(item.id, column.id);
  // Broadcast the local user's focus on this cell while they're editing it; the
  // hook clears it on blur/unmount. Called unconditionally (once per cell) so it
  // stays valid across the kind-specific early returns below.
  usePresenceFocus({ viewKind: "table", targetId: target }, isEditing);

  // Files cells are not inline-edited like other kinds: they render a thumbnail
  // strip + upload affordance, and open a lightbox on click. Thumbnails use
  // icons (no signed URLs on load); preview URLs are minted on lightbox open.
  if (column.kind === "files") {
    const files = filesForCell(controls.cache, item.id, column.id);
    return (
      <div className="flex h-full items-center border-l px-3">
        <FilesCell
          files={files}
          previewUrls={{}}
          onOpen={(i) => controls.openFilesLightbox(files, i)}
          onUpload={(f) => controls.uploadColumnFile(item.id, column.id, f)}
        />
      </div>
    );
  }

  // Time-tracking cells need the board cache + timer callbacks — special-cased
  // like files; not routed through CellRenderer or the isEditing/inline branch.
  if (column.kind === "time_tracking") {
    const entries = timeEntriesForCell(controls.cache, item.id, column.id);
    const estimate =
      (value as { estimateSeconds?: number } | null)?.estimateSeconds ?? null;
    return (
      <div className="flex h-full items-center border-l px-3">
        <TimeTrackingCell
          entries={entries}
          estimateSeconds={estimate}
          currentUserId={controls.currentUserId}
          onStart={() => controls.startTimer(item.id, column.id)}
          onStop={(id) => controls.stopTimer(id)}
          onAddManual={(date, secs) =>
            controls.addManualEntry(item.id, column.id, date, secs)
          }
          onEdit={(id, date, secs) => controls.editEntry(id, date, secs)}
          onDelete={(id) => controls.deleteEntry(id)}
          onSetEstimate={(secs) =>
            controls.setEstimate(item.id, column.id, secs)
          }
        />
      </div>
    );
  }

  // Relation cells render linked-item chips + an RLS-scoped picker; links live
  // in relation_links (not cell_values), so they're special-cased like files.
  if (column.kind === "relation") {
    const links = relationLinksForCell(controls.cache, item.id, column.id);
    const relSettings = (column.settings ?? {}) as {
      target_board_id?: string;
      allow_multiple?: boolean;
    };
    const targetBoardId = relSettings.target_board_id ?? "";
    return (
      <div className="flex h-full items-center border-l px-1">
        <RelationCell
          links={links}
          allowMultiple={relSettings.allow_multiple ?? true}
          loadCandidates={(search) =>
            targetBoardId
              ? listRelationCandidates(targetBoardId, search)
              : Promise.resolve([])
          }
          onChange={(selection) => {
            const newLinks: RelationLink[] = selection.map((s, i) => ({
              id: `optimistic-${item.id}-${column.id}-${s.linkedItemId}`,
              itemId: item.id,
              columnId: column.id,
              linkedItemId: s.linkedItemId,
              linkedItemName: s.linkedItemName,
              position: i,
            }));
            controls.setRelationLinks({
              itemId: item.id,
              columnId: column.id,
              links: newLinks,
            });
          }}
        />
      </div>
    );
  }

  // Mirror cells reflect a target column's value across linked items; they are
  // strictly read-only (no editor) and derive from the mirror cache slices.
  if (column.kind === "mirror") {
    const values = mirrorValuesForCell(controls.cache, item.id, column);
    const target = mirrorTargetColumnFor(controls.cache, column);
    return (
      <div className="flex h-full items-center border-l px-3">
        {target ? (
          <MirrorCell
            values={values}
            targetKind={target.kind as ColumnKind}
            targetSettings={(target.settings ?? {}) as Record<string, unknown>}
          />
        ) : (
          <span className="text-muted-foreground text-sm">—</span>
        )}
      </div>
    );
  }

  if (isEditing) {
    return (
      <div className="relative flex items-center border-l px-3">
        <CellEditor
          kind={column.kind}
          value={value}
          settings={settings}
          members={members}
          dependents={dependents}
          onCommit={(v) => {
            setCell({ itemId: item.id, columnId: column.id, value: v });
            setEditing(null);
          }}
          onClear={() => {
            clearCellValue({ itemId: item.id, columnId: column.id });
            setEditing(null);
          }}
          onCancel={() => setEditing(null)}
        />
        <PresenceRing target={target} />
        <FlashHighlight target={target} />
      </div>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={accessibleName}
      onClick={() => setEditing({ itemId: item.id, columnId: column.id })}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setEditing({ itemId: item.id, columnId: column.id });
        }
      }}
      className="hover:bg-surface-muted focus-visible:ring-ring relative flex h-full cursor-pointer items-center truncate border-l px-3 transition-colors focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset"
    >
      <CellRenderer
        kind={column.kind}
        value={value}
        settings={settings}
        members={members}
        overdue={overdue}
        dependents={dependents}
      />
      <PresenceRing target={target} />
      <FlashHighlight target={target} />
    </div>
  );
}

/**
 * The built-in primary "Name" cell. Supports optional leading (chevron/spacer),
 * trailing (add-subitem + row menu), indented layout, and auto-focus rename.
 */
function NameCell({
  item,
  controls,
  leading,
  trailing,
  indented = false,
  autoFocusRename = false,
  onRenameSettled,
}: {
  item: Item;
  controls: CellControls;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  indented?: boolean;
  autoFocusRename?: boolean;
  onRenameSettled?: () => void;
}) {
  const [editing, setEditing] = useState(autoFocusRename);
  const [name, setName] = useState(item.name);
  const [isPending, startTransition] = useTransition();

  function open() {
    setName(item.name);
    setEditing(true);
  }

  function commit() {
    const trimmed = name.trim();
    setEditing(false);
    onRenameSettled?.();
    if (!trimmed || trimmed === item.name) return;
    startTransition(async () => {
      controls.renameItemInCache({ itemId: item.id, name: trimmed });
    });
  }

  if (editing) {
    return (
      <div
        className={cn(
          "sticky left-0 z-10 flex items-center px-4",
          indented ? "bg-surface-sunken" : "bg-surface",
          NAME_FREEZE_EDGE,
        )}
      >
        {leading}
        <Input
          autoFocus
          value={name}
          disabled={isPending}
          onChange={(e) => setName(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setEditing(false);
              onRenameSettled?.();
            }
          }}
          aria-label={`Rename ${item.name}`}
          className="h-7"
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "group/name sticky left-0 z-10 flex h-full items-center pr-2 transition-colors",
        indented
          ? "bg-surface-sunken hover:bg-surface"
          : "bg-surface hover:bg-surface-muted",
        NAME_FREEZE_EDGE,
      )}
    >
      {leading}
      <div
        role="button"
        tabIndex={0}
        aria-label={`${item.name} name`}
        onClick={open}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            open();
          }
        }}
        className={cn(
          "focus-visible:ring-ring flex h-full min-w-0 flex-1 cursor-pointer items-center truncate text-sm focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset",
          indented ? "pl-8" : "px-4",
        )}
      >
        {item.name}
      </div>
      <button
        type="button"
        aria-label={`Open ${item.name}`}
        onClick={() => openItemPanel(item.id)}
        className="hover:bg-accent text-muted-foreground hover:text-foreground focus-visible:ring-ring grid size-7 shrink-0 place-items-center rounded-md opacity-0 transition-opacity group-hover/name:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:outline-none pointer-coarse:size-11 pointer-coarse:opacity-100"
      >
        <Maximize2 className="size-3.5" />
      </button>
      {trailing}
    </div>
  );
}

function AddGroupRow({ onAdd }: { onAdd: () => void }) {
  return (
    <button
      type="button"
      onClick={onAdd}
      className="text-muted-foreground hover:text-foreground hover:bg-surface focus-visible:ring-ring sticky left-0 flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none"
    >
      <Plus className="size-4 shrink-0" aria-hidden />
      Add group
    </button>
  );
}

function AddItemRow({
  groupId,
  controls,
  nameWidth,
}: {
  groupId: string;
  controls: CellControls;
  nameWidth: number;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function commit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setError(null);
    startTransition(async () => {
      controls.addItem(
        { groupId, name: trimmed },
        {
          onSuccess: () => {
            setName("");
            setError(null);
          },
          onError: (err) => {
            setError(err.message);
          },
        },
      );
    });
  }

  return (
    <div
      className="bg-surface sticky left-0 flex flex-col border-b px-4 py-1.5"
      style={{ width: nameWidth }}
    >
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
          disabled={isPending}
          placeholder="Add Item"
          aria-label="Add item"
          className="text-foreground placeholder:text-muted-foreground focus-visible:ring-ring w-full bg-transparent text-sm outline-none focus-visible:rounded-sm focus-visible:ring-2 disabled:opacity-50"
        />
      </div>
      {error ? (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      ) : null}
    </div>
  );
}
