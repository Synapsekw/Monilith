"use client";

import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import dynamic from "next/dynamic";
import { X } from "lucide-react";
import {
  DndContext,
  DragOverlay,
  pointerWithin,
  closestCenter,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { useTouchAwareSensors } from "@/lib/dnd/sensors";
import { reorderPosition } from "@/lib/boards/group-reorder";
import { crossGroupInsertPosition } from "@/lib/boards/board-dnd";
import { bucketItems, withSubitems } from "@/lib/boards/item-tree";
import type { BoardPayload, Column, Item } from "@/lib/boards/queries";
import type { AggregationId } from "@/lib/validations/boards";
import { RelationColumnConfig } from "@/components/boards/RelationColumnConfig";
import { MirrorColumnConfig } from "@/components/boards/MirrorColumnConfig";
import { SummaryRow } from "@/components/boards/SummaryRow";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  listMirrorableColumns,
  listRelationTargetBoards,
} from "@/lib/boards/relation-candidates";
import { FilePreviewLightbox } from "@/components/boards/item-panel/FilePreviewLightbox";
import {
  getAttachmentDownloadUrl,
  getAttachmentPreviewUrls,
} from "@/lib/collaboration/actions";
import { BoardHeader } from "@/components/boards/BoardHeader";
import type { BoardAccess, HeaderGrant } from "@/components/boards/BoardHeader";
import { type EditorMember } from "@/components/boards/cells/editors";
import type { CacheAttachment, CacheColumn } from "@/lib/boards/cache";
import { buildCellMap } from "@/lib/boards/cache";
import { buildDependentsCountMap } from "@/lib/boards/priority";
import { firstStatusColumn } from "@/lib/boards/overdue";
import { countOptionUsage } from "@/lib/boards/option-edit";
import { ColumnOptionsDialog } from "@/components/boards/ColumnOptionsDialog";
import { CurrencyDialog } from "@/components/boards/CurrencyDialog";
import { useBoardCache } from "@/lib/boards/use-board-cache";
import { useBoardMutations } from "@/lib/boards/use-board-mutations";
import { useBoardFilterSort } from "@/lib/boards/use-board-filter-sort";
import { useBoardViewPrefs } from "@/lib/boards/view-prefs-context";
import {
  useBoardIntelligenceOptional,
  useIntelItemIds,
} from "@/lib/boards/intelligence/context";
import { narrowItemsToSignal } from "@/lib/boards/intelligence/signals";
import {
  buildItemPredicate,
  buildItemComparator,
} from "@/lib/boards/board-filter";
import { EmptyState } from "@/components/ui/empty-state";
import { fitNameColumnWidth } from "@/lib/boards/name-column-width";
import { useBoardSelection } from "@/stores/board-selection";
import { BoardBulkBar } from "@/components/boards/BoardBulkBar";
import { AddGroupRow } from "./AddGroupRow";
import { GroupSection } from "./GroupSection";
import { useEditingCell } from "./editing-store";
import {
  gridTemplate,
  type CellControls,
  type ColumnHeaderControls,
  type GroupControls,
  type GroupSummaryControls,
} from "./shared";

/** Shared empty lists, so a group with no visible rows keeps stable props. */
const NO_ITEMS: Item[] = [];
const NO_IDS: string[] = [];
// Default-parameter empty arrays MUST be module constants: `members = []` in
// the signature allocates a fresh array on every render, which changes the
// memoized `controls` bundle's identity and re-renders every visible cell.
const NO_MEMBERS: EditorMember[] = [];
const NO_GRANTS: HeaderGrant[] = [];

// Lazy-load the Smart Fill dialog (and its AI action imports) only when a
// text column's header menu opens it — matches the AskPulseHost pattern.
const SmartFillDialog = dynamic(
  () =>
    import("@/components/ai/column-fill/SmartFillDialog").then(
      (m) => m.SmartFillDialog,
    ),
  { ssr: false },
);

// Memoized: BoardViews re-renders on every remote presence heartbeat (~6×/sec
// per active user), but BoardTable's props (payload/members/view/access/grants)
// are stable across those beats and it reads all live board data from its own
// `useBoardCache` (TanStack) subscription — so it re-renders on real cache
// changes (edits, realtime) regardless of memo, while skipping the heartbeat
// re-render cascade that previously re-rendered every visible row/cell. Presence
// overlays now subscribe to the presence focus store directly (see
// presence-focus-store.ts), so they still update per-cell without this re-render.
export function BoardTableInner({
  payload,
  members = NO_MEMBERS,
  selectedViewId,
  currentUserId = "",
  access = "owner",
  grants = NO_GRANTS,
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
  const { data: cache } = useBoardCache(payload.board.id, payload);
  const { board, groups, columns, items, cellValues } = cache;

  // Collapse + expansion are per-user, per-board arrangement, owned by the
  // view-prefs provider so they survive a reload and follow the user across
  // devices. Toggles are local-first; the provider debounces the write.
  const {
    collapsedGroups,
    expandedItems: expanded,
    toggleGroupCollapsed,
    toggleItemExpanded,
    pruneTo,
  } = useBoardViewPrefs();

  // Groups and items get deleted while their ids sit in a saved arrangement.
  // Intersect against what the board actually holds, so a dead id has no effect
  // and falls out of the stored row the first time the user opens the board.
  const groupIdsKey = groups.map((g) => g.id).join(",");
  const itemIdsKey = items.map((i) => i.id).join(",");
  useEffect(() => {
    pruneTo({
      groupIds: groupIdsKey ? groupIdsKey.split(",") : [],
      itemIds: itemIdsKey ? itemIdsKey.split(",") : [],
    });
    // Keyed on the joined id strings so this runs when the board's membership
    // changes, not on every re-render that rebuilds the arrays.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupIdsKey, itemIdsKey]);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [scrolledX, setScrolledX] = useState(false);

  // Edit mode lives in its own store, subscribed to per cell — NOT in this
  // component's state and NOT in the `controls` bundle. Holding it here handed
  // every visible cell a new bundle on each click (~300 re-renders to open one
  // editor, ~300 more to close it). See ./editing-store.
  const setEditing = useEditingCell((s) => s.setEditing);
  // Edit mode is scoped to ONE board: clear it on mount, on unmount, and when
  // this component is reused for a different board (the boards route keeps the
  // table mounted across a board switch), so it never bleeds across boards.
  // Same contract as presence-focus-store.
  useEffect(() => {
    setEditing(null);
    return () => setEditing(null);
  }, [setEditing, payload.board.id]);
  const [renameGroupId, setRenameGroupId] = useState<string | null>(null);
  const [renamingItemId, setRenamingItemId] = useState<string | null>(null);
  const [optionsFor, setOptionsFor] = useState<CacheColumn | null>(null);
  // "Change currency" dialog target (currency columns only).
  const [currencyFor, setCurrencyFor] = useState<CacheColumn | null>(null);
  // "Smart fill…" dialog source column (text columns only).
  const [smartFillFor, setSmartFillFor] = useState<CacheColumn | null>(null);
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
  // Thumbnail-transform URLs for the same cell's images (chips upgrade from an
  // icon to a small thumbnail on lightbox open; the lightbox keeps full-res).
  const [filesThumbUrls, setFilesThumbUrls] = useState<Record<string, string>>(
    {},
  );

  // Stable (useCallback) so the memoized `controls` bundle below keeps its
  // identity across non-data re-renders (column resize, horizontal scroll,
  // dialog open/close) — that's what lets the row/cell React.memo actually skip.
  const openFilesLightbox = useCallback(
    (files: readonly CacheAttachment[], index: number) => {
      const list = [...files];
      setFilesLightbox({ files: list, index });
      setFilesPreviewUrls({});
      setFilesThumbUrls({});
      // 96×96 = the size-6 chip (coarse size-11 = 44px) at ~2× DPR.
      void getAttachmentPreviewUrls({
        attachmentIds: list.map((a) => a.id),
        thumb: { width: 96, height: 96 },
      }).then((res) => {
        if (res.ok) {
          setFilesPreviewUrls(res.data.urls);
          setFilesThumbUrls(res.data.thumbUrls);
        }
      });
    },
    [],
  );

  async function downloadColumnFile(attachmentId: string) {
    const res = await getAttachmentDownloadUrl({ attachmentId });
    if (res.ok) window.open(res.data.url, "_blank", "noopener");
  }

  const toggleExpand = toggleItemExpanded;
  // Stable so the memoized ItemRow/SubitemBlock skip re-render on unrelated
  // parent updates (this is threaded down as onRenameSettled).
  const handleRenameItemSettled = useCallback(
    () => setRenamingItemId(null),
    [],
  );

  const mutations = useBoardMutations(payload.board.id, currentUserId);
  // useBoardMutations returns a fresh object of fresh closures every render,
  // which would change `controls`' identity each render and defeat the row/cell
  // React.memo. Forward through a ref so the exposed methods keep a STABLE
  // identity (fixed for the component's life) while always invoking the latest
  // mutation. Used to build the memoized `controls` bundle below.
  const mutationsRef = useRef(mutations);
  useEffect(() => {
    mutationsRef.current = mutations;
  });
  const m = useMemo(() => {
    const proxy = {} as typeof mutations;
    // Keys come from the render-scoped `mutations` (stable shape); each wrapper
    // reads `mutationsRef.current` only when INVOKED (event handler), never
    // during render — so the exposed identities stay stable for the memo.
    for (const key of Object.keys(mutations) as (keyof typeof mutations)[]) {
      proxy[key] = ((...args: unknown[]) =>
        (mutationsRef.current[key] as (...a: unknown[]) => unknown)(
          ...args,
        )) as never;
    }
    return proxy;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Board-level error surface for column-add failures. The Add-column menu is a
  // header dropdown with no inline spot, so failures (which were previously
  // swallowed silently) surface as a dismissible banner. Mirrors AddItemRow's
  // inline role="alert" pattern; the project has no toast primitive yet.
  const [columnError, setColumnError] = useState<string | null>(null);
  // Group mutations used directly in the render body (add-group row, the drag
  // handler) — neither is a memoized prop, so a plain destructure is fine. The
  // group actions that ARE threaded down go through the stable `m` proxy (see
  // `groupControls`), as do the cell/item mutations inside `controls`.
  const { addGroup, reorderGroup } = mutations;

  // Cell lookup keyed by `${item_id}:${column_id}` → raw JSON value.
  const cellMap = useMemo(() => buildCellMap(cellValues), [cellValues]);

  // The board's first status column, resolved ONCE per render and threaded via
  // `controls`. Date cells derive their overdue tint from it; deriving it inside
  // each cell was a filter + sort of every column per cell, per render.
  const statusColumn = useMemo(() => firstStatusColumn(columns), [columns]);

  // Direct-dependent counts for priority cells: one O(edges) pass for the whole
  // board, threaded down via `controls` (same pattern as cellMap) instead of
  // recomputed inside every visible ItemRow/SortableSubitemRow.
  const dependentsByItem = useMemo(
    () => buildDependentsCountMap(cache.dependencies),
    [cache.dependencies],
  );

  // `topLevel`/`childrenByParent` bucket the FULL, unnarrowed board — the Board
  // Total footer and the drag-start item lookup below both intentionally stay
  // unaffected by any in-page narrowing (quick search already doesn't touch
  // them either), so they always read off this pair, never the intel-narrowed
  // one below.
  const { topLevel, childrenByParent } = useMemo(
    () => bucketItems(items),
    [items],
  );

  // Active Intelligence chip (null = none). `narrowItemsToSignal` runs on the
  // FULL flat item list (not just `topLevel`) — a matching SUB-item's parent
  // must be kept even though the parent itself carries `parent_id: null` and
  // never appears in `itemIds`, and `narrowItemsToSignal` can only see that
  // relationship when parent and child are in the same input array. Narrowing
  // a per-group, top-level-only list (as an earlier version of this code did)
  // silently dropped the parent of every matching sub-item.
  const intelItemIds = useIntelItemIds();
  const intelGroupIds =
    useBoardIntelligenceOptional()?.activeSignal?.groupIds ?? null;
  // No chip active → reuse the identity of `topLevel`/`childrenByParent`
  // above instead of paying a second `bucketItems` pass (the hot, default
  // path).
  const {
    topLevel: visibleTopLevel,
    childrenByParent: visibleChildrenByParent,
  } = useMemo(
    () =>
      intelItemIds === null
        ? { topLevel, childrenByParent }
        : bucketItems(narrowItemsToSignal(items, intelItemIds)),
    [intelItemIds, items, topLevel, childrenByParent],
  );

  // Top-level items grouped by group_id, in position order.
  const itemsByGroup = useMemo(() => {
    const byGroup = new Map<string, typeof visibleTopLevel>();
    for (const g of groups) byGroup.set(g.id, []);
    for (const it of visibleTopLevel) {
      const bucket = byGroup.get(it.group_id);
      if (bucket) bucket.push(it);
      else byGroup.set(it.group_id, [it]);
    }
    return byGroup;
  }, [groups, visibleTopLevel]);

  // Filter / sort / quick-search state — read from the URL, applied to the
  // already-loaded cache in memory (0 server round-trips; see AGENTS.md
  // invariants / gotcha-09). Filtering narrows TOP-LEVEL rows only; subitems
  // still show under an expanded parent. Sorting reorders WITHIN each group so
  // group order (position) is preserved. Typing stays smooth on large boards:
  // the URL write is debounced upstream (one write per pause, not per keystroke
  // — see useBoardFilterSort) and the search term is deferred here so the heavy
  // filter/sort scan yields to input paint. Memoized so 5k rows aren't
  // re-scanned on unrelated re-renders (presence heartbeats).
  const filter = useBoardFilterSort();
  // Defer the *search* term so a fast typist never blocks on the row scan; the
  // heavy filter memo recomputes against the trailing value while the input
  // stays responsive. Non-search filter changes (discrete toggles) aren't
  // deferred — they apply on the next commit.
  const deferredQ = useDeferredValue(filter.state.q);
  const effectiveFilterState = useMemo(
    () => ({ ...filter.state, q: deferredQ }),
    [filter.state, deferredQ],
  );
  const predicate = useMemo(
    () => buildItemPredicate(effectiveFilterState, { columns, cellMap }),
    [effectiveFilterState, columns, cellMap],
  );
  const comparator = useMemo(
    () => buildItemComparator(effectiveFilterState, { columns, cellMap }),
    [effectiveFilterState, columns, cellMap],
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

  // Per-group id arrays for dnd-kit's SortableContext. Memoizing on
  // `visibleItemsByGroup` is NOT enough to keep them referentially stable: its
  // deps include `cellMap` (the filter predicate and the sort comparator read
  // cell values), so a single-cell patch recomputes content-equal arrays. Each
  // `GroupSection` therefore holds its own array's identity with `useStableIds`
  // — per group, so one group's change doesn't churn the others' contexts.
  const itemIdsByGroup = useMemo(() => {
    const out = new Map<string, string[]>();
    for (const [gid, list] of visibleItemsByGroup)
      out.set(
        gid,
        list.map((i) => i.id),
      );
    return out;
  }, [visibleItemsByGroup]);
  const groupIds = useMemo(() => groups.map((g) => g.id), [groups]);
  /** `{id, name}` for the header + bulk bar pickers (stable across re-renders). */
  const groupOptions = useMemo(
    () => groups.map((g) => ({ id: g.id, name: g.name })),
    [groups],
  );

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

  // Offscreen canvas measurer at the Name cell font (Nunito Sans 14px / text-sm), used
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

  // TODO(perf-follow-up): `template` is the CSS grid-template string and it is
  // threaded to every row as an inline style, so a live column resize
  // (`liveWidths` ticking per pointer-move) re-renders EVERY visible row and
  // cell — the one interaction the row memoization above cannot help with.
  // The fix is to stop passing widths through React at all: set
  // `--board-grid-template` as a custom property on the scroll container and
  // have rows use `gridTemplateColumns: var(--board-grid-template)`, so a
  // resize is a single style write on one element. It is deferred because it
  // has to land in one go across every grid-row surface — the group header row,
  // the item/subitem rows, the summary rows AND AddItemRow (owned by the
  // optimistic-add work) — all of which read `template`/`nameWidth` today.
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
  // Stable (the mutation comes from the `m` proxy) so the bundles below are too.
  const setColumnSummary = useCallback(
    (col: Column, agg: AggregationId | null) => {
      const next = { ...((col.settings as Record<string, unknown>) ?? {}) };
      if (agg) next.summary_aggregation = agg;
      else delete next.summary_aggregation;
      m.updateColumnSettings(col.id, next);
    },
    [m],
  );

  // One shared bundle for every group's summary row (see GroupSummaryControls).
  // Memoized: an object literal here changed identity every render and, through
  // GroupSection, re-rendered every group (and so every row and cell).
  const groupSummary: GroupSummaryControls = useMemo(
    () => ({ canEdit, nowMs: footerNowMs, onChange: setColumnSummary }),
    [canEdit, footerNowMs, setColumnSummary],
  );

  // Board-level column-management surface shared by every group's header row
  // (columns are board-scoped). Width state stays here so a resize/add/rename
  // from any group reflows all groups + the footer. Memoized on the width state
  // alone — every callback below is stable (the `m` proxy / setState setters) —
  // so a dialog, a scroll or a cell edit no longer re-creates it.
  const columnControls: ColumnHeaderControls = useMemo(
    () => ({
      nameWidth,
      liveWidths,
      setLiveWidths,
      setLiveNameWidth,
      renameColumn: m.renameColumn,
      deleteColumn: m.deleteColumn,
      resizeColumn: m.resizeColumn,
      reorderColumn: m.reorderColumn,
      resizeNameColumn: m.resizeNameColumn,
      onAddColumn: (kind) => {
        if (kind === "relation") {
          setRelationTargetBoards([]);
          setRelationConfigOpen(true);
          listRelationTargetBoards().then(setRelationTargetBoards);
        } else if (kind === "mirror") {
          setMirrorConfigOpen(true);
        } else {
          setColumnError(null);
          m.addColumn(kind, undefined, {
            onError: (err) => setColumnError(err.message),
          });
        }
      },
      onEditOptions: (c) => setOptionsFor(c),
      onEditCurrency: (c) => setCurrencyFor(c),
      onSmartFill: (c) => setSmartFillFor(c),
    }),
    [nameWidth, liveWidths, m],
  );

  // Id-keyed group actions, built once for the whole board: the per-group
  // closures these replace were rebuilt every render and defeated
  // GroupSection's memo.
  const clearRenameGroup = useCallback(() => setRenameGroupId(null), []);
  const groupControls: GroupControls = useMemo(
    () => ({
      rename: m.renameGroup,
      setColor: m.setGroupColor,
      remove: m.deleteGroup,
      toggleCollapsed: toggleGroupCollapsed,
      onRenameSettled: clearRenameGroup,
    }),
    [m, toggleGroupCollapsed, clearRenameGroup],
  );

  // Stable subitem-add wrapper (adapts the mutation's onSuccess(item) → id).
  const addSubitemControl = useCallback(
    (
      parentId: string,
      name: string,
      cbs?: {
        onSuccess?: (id: string) => void;
        onError?: (err: Error) => void;
      },
    ) =>
      m.addSubitem(parentId, name, {
        onSuccess: (item) => cbs?.onSuccess?.(item.id),
        onError: cbs?.onError,
      }),
    [m],
  );

  // Memoized so the bundle only changes when its real data deps do (edit mode,
  // cache, members, dependents map) — NOT on every re-render. All mutation
  // methods come from the stable `m` proxy, so a column resize / scroll / dialog
  // toggle no longer re-creates `controls` and the row/cell React.memo can skip.
  const controls: CellControls = useMemo(
    () => ({
      setEditing,
      setCell: m.setCell,
      clearCellValue: m.clearCellValue,
      members,
      boardId: payload.board.id,
      currentUserId,
      addItem: m.addItem,
      renameItemInCache: m.renameItem,
      addSubitem: addSubitemControl,
      deleteItem: m.deleteItem,
      reorderItem: m.reorderItem,
      moveItemToGroup: m.moveItemToGroup,
      cache,
      dependentsByItem,
      statusColumn,
      uploadColumnFile: m.uploadColumnFile,
      openFilesLightbox,
      filesPreviewUrls,
      filesThumbUrls,
      startTimer: m.startTimer,
      stopTimer: m.stopTimer,
      addManualEntry: m.addManualEntry,
      editEntry: m.editEntry,
      deleteEntry: m.deleteEntry,
      setEstimate: m.setEstimate,
      setRelationLinks: m.setRelationLinks,
    }),
    [
      setEditing,
      m,
      members,
      payload.board.id,
      currentUserId,
      addSubitemControl,
      cache,
      dependentsByItem,
      statusColumn,
      openFilesLightbox,
      filesPreviewUrls,
      filesThumbUrls,
    ],
  );

  const sensors = useTouchAwareSensors();

  // Drag overlay descriptor for the active group/item (null when idle).
  const [activeDrag, setActiveDrag] = useState<{
    id: string;
    type: "item" | "group";
    name: string;
  } | null>(null);

  // One board-level context now owns BOTH group-reorder and item drags, so its
  // collision strategy must switch by draggable type: groups collide by center
  // (header-to-header), item rows collide by pointer against other rows first,
  // then fall back to the group *container* droppable when the pointer is in a
  // gap or over a collapsed group — that container drop = append into the group.
  const boardCollision: CollisionDetection = (args) => {
    const type = args.active.data.current?.type;
    if (type === "group") {
      return closestCenter({
        ...args,
        droppableContainers: args.droppableContainers.filter(
          (c) => c.data.current?.type === "group",
        ),
      });
    }
    const rowHits = pointerWithin({
      ...args,
      droppableContainers: args.droppableContainers.filter(
        (c) => c.data.current?.type === "item",
      ),
    });
    if (rowHits.length > 0) return rowHits;
    return pointerWithin({
      ...args,
      droppableContainers: args.droppableContainers.filter(
        (c) => c.data.current?.type === "group-container",
      ),
    });
  };

  function handleBoardDragStart(e: DragStartEvent) {
    const type = e.active.data.current?.type;
    if (type === "group") {
      const g = groups.find((x) => x.id === e.active.id);
      setActiveDrag(g ? { id: g.id, type: "group", name: g.name } : null);
    } else {
      const it = topLevel.find((x) => x.id === e.active.id);
      setActiveDrag(it ? { id: it.id, type: "item", name: it.name } : null);
    }
  }

  function handleBoardDragEnd(e: DragEndEvent) {
    setActiveDrag(null);
    const { active, over } = e;
    if (!over) return;
    const activeType = active.data.current?.type;

    if (activeType === "group") {
      if (over.data.current?.type !== "group" || active.id === over.id) return;
      const position = reorderPosition(
        groups.map((g) => ({ id: g.id, position: g.position })),
        String(active.id),
        String(over.id),
      );
      if (position !== null) reorderGroup(String(active.id), position);
      return;
    }

    // item drag
    const fromGroup = String(active.data.current?.groupId);
    const overData = over.data.current;
    const toGroup =
      overData?.type === "group-container"
        ? String(overData.groupId)
        : String(overData?.groupId ?? "");
    if (!toGroup) return;

    if (toGroup === fromGroup) {
      if (active.id === over.id) return;
      const position = reorderPosition(
        (visibleItemsByGroup.get(fromGroup) ?? []).map((i) => ({
          id: i.id,
          position: i.position,
        })),
        String(active.id),
        String(over.id),
      );
      if (position !== null) controls.reorderItem(String(active.id), position);
      return;
    }

    // cross-group: compute the exact slot, or append when dropped on the
    // group container (no `over` row under the pointer).
    const targetItems = (visibleItemsByGroup.get(toGroup) ?? []).map((i) => ({
      id: i.id,
      position: i.position,
    }));
    if (overData?.type === "group-container") {
      controls.moveItemToGroup(String(active.id), toGroup); // append
      return;
    }
    const activeTop =
      active.rect.current.translated?.top ??
      active.rect.current.initial?.top ??
      0;
    const overMid = over.rect.top + over.rect.height / 2;
    const dropBelow = activeTop > overMid;
    const position = crossGroupInsertPosition(
      targetItems,
      String(over.id),
      dropBelow,
    );
    controls.moveItemToGroup(String(active.id), toGroup, position);
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
        groups={groupOptions}
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
            className="text-muted-foreground hover:text-foreground hover:bg-state-hover flex size-6 shrink-0 items-center justify-center rounded-md"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ) : null}

      <div
        ref={scrollContainerRef}
        data-testid="board-scroll"
        data-scroll-container
        data-scrolledx={scrolledX}
        onScroll={(e) => {
          const next = e.currentTarget.scrollLeft > 0;
          // setState bails out when unchanged, so this only re-renders on the
          // 0 ⇄ >0 boundary (cheap during scroll).
          setScrolledX(next);
        }}
        className="group/scroll bg-surface ease-keystone border-border hover:border-border-hover mx-3 mt-3 mb-6 flex-1 overflow-auto rounded-lg border transition-colors"
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
              id="board-dnd"
              sensors={sensors}
              collisionDetection={boardCollision}
              modifiers={[restrictToVerticalAxis]}
              onDragStart={handleBoardDragStart}
              onDragEnd={handleBoardDragEnd}
            >
              <SortableContext
                items={groupIds}
                strategy={verticalListSortingStrategy}
              >
                {groups.map((group, groupIndex) => (
                  <GroupSection
                    key={group.id}
                    group={group}
                    groupIndex={groupIndex}
                    items={visibleItemsByGroup.get(group.id) ?? NO_ITEMS}
                    itemIds={itemIdsByGroup.get(group.id) ?? NO_IDS}
                    columns={columns}
                    selectable={canEdit}
                    col={columnControls}
                    cellMap={cellMap}
                    template={template}
                    controls={controls}
                    summary={groupSummary}
                    groupControls={groupControls}
                    nameWidth={nameWidth}
                    autoFocusRename={group.id === renameGroupId}
                    childrenByParent={visibleChildrenByParent}
                    collapsed={
                      collapsedGroups.has(group.id) &&
                      !(intelGroupIds?.includes(group.id) ?? false)
                    }
                    expanded={expanded}
                    onToggleExpand={toggleExpand}
                    renamingItemId={renamingItemId}
                    onRenameItemSettled={handleRenameItemSettled}
                    onSetRenamingItemId={setRenamingItemId}
                    scrollContainerRef={scrollContainerRef}
                    contentRef={contentRef}
                  />
                ))}
              </SortableContext>
              <DragOverlay>
                {activeDrag ? (
                  <div className="bg-surface shadow-drag flex items-center border px-4 py-1.5 text-sm">
                    {activeDrag.name}
                  </div>
                ) : null}
              </DragOverlay>
            </DndContext>
          )}
          <AddGroupRow
            canEdit={canEdit}
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
              label="Board Total"
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

      {smartFillFor && (
        <SmartFillDialog
          boardId={board.id}
          sourceColumn={smartFillFor}
          targetColumns={columns.filter(
            (c) => c.kind === "status" || c.kind === "dropdown",
          )}
          onClose={() => setSmartFillFor(null)}
        />
      )}

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
          groups={groupOptions}
          columns={columns}
          members={members}
        />
      )}
    </div>
  );
}
