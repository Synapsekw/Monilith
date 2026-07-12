"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
import type {
  BoardCache,
  CacheAttachment,
  CacheColumn,
} from "@/lib/boards/cache";
import { buildCellMap } from "@/lib/boards/cache";
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
import { fitNameColumnWidth } from "@/lib/boards/name-column-width";
import { useBoardSelection } from "@/stores/board-selection";
import { BoardBulkBar } from "@/components/boards/BoardBulkBar";
import { AddGroupRow } from "./AddGroupRow";
import { GroupSection } from "./GroupSection";
import {
  gridTemplate,
  type CellControls,
  type ColumnHeaderControls,
  type EditingCell,
  type GroupSummaryControls,
} from "./shared";

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
    moveItemToGroup,
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
    onSmartFill: (c) => setSmartFillFor(c),
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
    moveItemToGroup,
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
                items={groups.map((g) => g.id)}
                strategy={verticalListSortingStrategy}
              >
                {groups.map((group, groupIndex) => (
                  <GroupSection
                    key={group.id}
                    group={group}
                    groupIndex={groupIndex}
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
              <DragOverlay>
                {activeDrag ? (
                  <div className="bg-surface flex items-center border px-4 py-1.5 text-sm shadow-lg">
                    {activeDrag.name}
                  </div>
                ) : null}
              </DragOverlay>
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
          groups={groups.map((g) => ({ id: g.id, name: g.name }))}
          columns={columns}
          members={members}
        />
      )}
    </div>
  );
}
