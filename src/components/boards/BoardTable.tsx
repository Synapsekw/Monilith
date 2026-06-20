"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ChevronDown,
  ChevronRight,
  GripVertical,
  Maximize2,
  MoreHorizontal,
  Plus,
} from "lucide-react";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { CSS } from "@dnd-kit/utilities";
import { reorderPosition } from "@/lib/boards/group-reorder";
import { bucketItems } from "@/lib/boards/item-tree";
import { rollupCell } from "@/lib/boards/rollup";
import type { BoardPayload, Column, Group, Item } from "@/lib/boards/queries";
import type { ColumnOption } from "@/lib/validations/boards";
import { CellRenderer } from "@/components/boards/cells";
import { FilesCell } from "@/components/boards/cells/FilesCell";
import { FilePreviewLightbox } from "@/components/boards/item-panel/FilePreviewLightbox";
import {
  getAttachmentDownloadUrl,
  getAttachmentPreviewUrls,
} from "@/lib/collaboration/actions";
import { RollupCell } from "@/components/boards/RollupCell";
import { BoardHeader } from "@/components/boards/BoardHeader";
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
import { buildCellMap, cellKey, filesForCell } from "@/lib/boards/cache";
import { countOptionUsage } from "@/lib/boards/option-edit";
import { ColumnOptionsDialog } from "@/components/boards/ColumnOptionsDialog";
import { useBoardCache } from "@/lib/boards/use-board-cache";
import { useBoardMutations } from "@/lib/boards/use-board-mutations";
import { ColumnHeader } from "@/components/boards/ColumnHeader";
import { AddColumnMenu } from "@/components/boards/AddColumnMenu";
import {
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
};

const ROW_HEIGHT = 36; // direction C density

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

/** CSS grid template: pinned Name + one fixed px track per column + the add-column slot. */
function gridTemplate(
  columns: { id: string; width: number | null }[],
  liveWidths: Record<string, number>,
  nameWidth: number,
): string {
  const tracks = columns
    .map((c) => `${liveWidths[c.id] ?? c.width ?? VALUE_COL_WIDTH}px`)
    .join(" ");
  return `${nameWidth}px ${tracks} ${ADD_COL_WIDTH}px`;
}

export function BoardTable({
  payload,
  members = [],
  selectedViewId,
  currentUserId = "",
}: {
  payload: BoardPayload;
  members?: EditorMember[];
  selectedViewId: string;
  currentUserId?: string;
}) {
  // Hydrate the ["board", boardId] cache once from the server payload; read all
  // board data from the cache so optimistic + realtime patches re-render.
  const { data: cache } = useBoardCache(
    payload.board.id,
    payload as unknown as BoardCache,
  );
  const { board, groups, columns, items, cellValues } = cache;

  const [editing, setEditing] = useState<EditingCell | null>(null);
  const [renameGroupId, setRenameGroupId] = useState<string | null>(null);
  const [renamingItemId, setRenamingItemId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [optionsFor, setOptionsFor] = useState<CacheColumn | null>(null);

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

  const controls: CellControls = {
    editing,
    setEditing,
    setCell,
    clearCellValue,
    members,
    boardId: payload.board.id,
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
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

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
    <div className="flex h-full flex-col">
      <BoardHeader
        boardId={board.id}
        boardName={board.name}
        views={payload.views}
        selectedViewId={selectedViewId}
        columns={columns}
        members={members}
      />

      <div className="flex-1 overflow-auto">
        <div className="min-w-fit">
          {/* Column header row */}
          <div
            className="bg-surface-muted text-muted-foreground sticky top-0 z-20 grid border-b text-xs font-medium"
            style={{ gridTemplateColumns: template }}
          >
            <NameColumnHeader
              width={nameWidth}
              onResize={(w) => setLiveNameWidth(w)}
              onResizeEnd={(w) => {
                setLiveNameWidth(null);
                mutations.resizeNameColumn(w);
              }}
              onAutoFit={() => {
                setLiveNameWidth(null);
                mutations.resizeNameColumn(null);
              }}
            />
            {columns.map((col) => (
              <ColumnHeader
                key={col.id}
                column={col}
                width={liveWidths[col.id] ?? col.width ?? VALUE_COL_WIDTH}
                onRename={(name) => mutations.renameColumn(col.id, name)}
                onDelete={() => mutations.deleteColumn(col.id)}
                onResize={(w) => setLiveWidths((m) => ({ ...m, [col.id]: w }))}
                onResizeEnd={(w) => mutations.resizeColumn(col.id, w)}
                onEditOptions={() => setOptionsFor(col)}
              />
            ))}
            <AddColumnMenu onAdd={(kind) => mutations.addColumn(kind)} />
          </div>

          {groups.length === 0 ? (
            <p className="text-muted-foreground px-4 py-6 text-sm">
              This board has no groups yet.
            </p>
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
                    items={itemsByGroup.get(group.id) ?? []}
                    columns={columns}
                    cellMap={cellMap}
                    template={template}
                    controls={controls}
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
    </div>
  );
}

/**
 * Header for the built-in Name column: a sticky "Name" label plus a right-edge
 * resize handle that mirrors {@link ColumnHeader}. Drag resizes live (0 server
 * round-trips) and persists the px width on release; double-clicking the handle
 * clears the manual width so the column returns to auto-fit.
 */
function NameColumnHeader({
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
  function onPointerDown(e: React.PointerEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    let last = width;
    const move = (ev: PointerEvent) => {
      last = Math.min(
        NAME_COL_MAX,
        Math.max(NAME_DRAG_MIN, startW + (ev.clientX - startX)),
      );
      onResize(last);
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
    <div className="bg-surface-muted sticky left-0 z-10 flex items-center truncate px-4 py-1.5">
      Name
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize Name column (double-click to auto-fit)"
        onPointerDown={onPointerDown}
        onDoubleClick={onAutoFit}
        className="hover:bg-primary/40 absolute top-0 right-0 h-full w-1 cursor-col-resize"
      />
    </div>
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
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring ml-auto grid size-7 shrink-0 place-items-center rounded-md opacity-0 transition-opacity group-hover/grouphdr:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:outline-none"
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
            className="text-muted-foreground hover:text-foreground grid size-7 shrink-0 place-items-center rounded-md opacity-0 transition-opacity group-hover/name:opacity-100 focus-visible:opacity-100"
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

function GroupSection({
  group,
  items,
  columns,
  cellMap,
  template,
  controls,
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
}: {
  group: Group;
  items: Item[];
  columns: Column[];
  cellMap: Map<string, CacheCellValue["value"]>;
  template: string;
  controls: CellControls;
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
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [renaming, setRenaming] = useState(autoFocusRename);
  const [name, setName] = useState(group.name);
  const scrollRef = useRef<HTMLDivElement>(null);

  const {
    setNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: group.id });

  const itemSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

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
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 6,
    // getBoundingClientRect().height returns 0 in jsdom — fall back to ROW_HEIGHT
    // so tests don't collapse all virtual rows to 0px height.
    measureElement: (el) => el.getBoundingClientRect().height || ROW_HEIGHT,
  });

  const virtualRows = virtualizer.getVirtualItems();
  // Cap the scroll viewport; long/expanded groups scroll inside it.
  const viewportHeight =
    Math.min(virtualizer.getTotalSize(), 12 * ROW_HEIGHT) || ROW_HEIGHT;

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
      {/* Colored band header — group.color tints the left rail + label. */}
      <div
        className="group/grouphdr bg-surface hover:bg-accent sticky left-0 flex w-full items-center gap-2 border-b px-3 py-1.5 text-sm font-semibold transition-colors"
        style={{ boxShadow: `inset 3px 0 0 0 ${group.color}` }}
      >
        <button
          type="button"
          aria-label={`Reorder ${group.name}`}
          {...attributes}
          {...listeners}
          className="text-muted-foreground hover:text-foreground grid size-7 shrink-0 cursor-grab touch-none place-items-center rounded-md opacity-0 transition-opacity group-hover/grouphdr:opacity-100 active:cursor-grabbing"
        >
          <GripVertical className="size-4" />
        </button>
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
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
            onChange={(e) => setName(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitRename();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setRenaming(false);
                onRenameSettled();
              }
            }}
            aria-label={`Rename ${group.name}`}
            className="h-7 max-w-xs"
          />
        ) : (
          <button
            type="button"
            onClick={openRename}
            className="focus-visible:ring-ring min-w-0 truncate rounded-sm text-left focus-visible:ring-2 focus-visible:outline-none"
          >
            {group.name}
          </button>
        )}
        <span className="text-muted-foreground text-xs font-normal">
          {items.length}
        </span>
        <GroupMenu
          group={group}
          onRename={openRename}
          onSetColor={onSetColor}
          onDelete={onDelete}
        />
      </div>

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
                  ref={scrollRef}
                  className="overflow-auto"
                  style={{ height: viewportHeight }}
                >
                  <div
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
                          style={{ transform: `translateY(${vr.start}px)` }}
                        >
                          <ItemRow
                            item={item}
                            columns={columns}
                            cellMap={cellMap}
                            template={template}
                            controls={controls}
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
                              onAdded={(id) => onSetRenamingItemId(id)}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </SortableContext>
            </DndContext>
          )}
          <AddItemRow
            groupId={group.id}
            controls={controls}
            nameWidth={nameWidth}
          />
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
  subitems: Item[];
  childCount: number;
  isExpanded: boolean;
  onToggle: () => void;
  autoFocusRename: boolean;
  onRenameSettled: () => void;
  onSubitemAdded?: (id: string) => void;
}) {
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
      className="text-muted-foreground hover:text-foreground grid size-6 shrink-0 cursor-grab touch-none place-items-center rounded opacity-0 transition-opacity group-hover/name:opacity-100 active:cursor-grabbing"
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
          className="text-muted-foreground hover:text-foreground grid size-7 shrink-0 place-items-center rounded-md opacity-0 transition-opacity group-hover/name:opacity-100 focus-visible:opacity-100"
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
          const values = subitems.map(
            (c) => cellMap.get(cellKey(c.id, col.id)) ?? null,
          );
          const settings = (col.settings ?? {}) as Settings;
          const result = rollupCell(col.kind, values, settings.options);
          return (
            <div
              key={col.id}
              className="flex h-full items-center truncate border-l px-3"
            >
              <RollupCell result={result} />
            </div>
          );
        }
        return (
          <EditableCell
            key={col.id}
            item={item}
            column={col}
            value={cellMap.get(cellKey(item.id, col.id)) ?? null}
            controls={controls}
          />
        );
      })}
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
      className="text-muted-foreground hover:text-foreground grid size-6 shrink-0 cursor-grab touch-none place-items-center rounded opacity-0 transition-opacity group-hover/name:opacity-100 active:cursor-grabbing"
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
      {columns.map((col) => (
        <EditableCell
          key={col.id}
          item={sub}
          column={col}
          value={cellMap.get(cellKey(sub.id, col.id)) ?? null}
          controls={controls}
        />
      ))}
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
  onAdded,
}: {
  parentId: string;
  subitems: Item[];
  columns: Column[];
  cellMap: Map<string, CacheCellValue["value"]>;
  template: string;
  controls: CellControls;
  renamingItemId: string | null;
  onRenameSettled: () => void;
  onAdded: (id: string) => void;
}) {
  const subitemSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

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
    <div>
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
      <AddSubitemRow
        parentId={parentId}
        controls={controls}
        onAdded={onAdded}
      />
    </div>
  );
}

/** Inline input row appended to the expanded subitem block. */
function AddSubitemRow({
  parentId,
  controls,
  onAdded,
}: {
  parentId: string;
  controls: CellControls;
  onAdded: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [isPending, startTransition] = useTransition();
  function commit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    startTransition(() =>
      controls.addSubitem(parentId, trimmed, {
        onSuccess: (id) => {
          setName("");
          onAdded(id);
        },
      }),
    );
  }
  return (
    <div className="bg-surface sticky left-0 flex items-center gap-2 border-b py-1.5 pr-4 pl-12">
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
}: {
  item: Item;
  column: Column;
  value: CacheCellValue["value"];
  controls: CellControls;
}) {
  const { editing, setEditing, setCell, clearCellValue, members } = controls;
  const isEditing =
    editing?.itemId === item.id && editing.columnId === column.id;
  const settings = (column.settings ?? {}) as Settings;
  const accessibleName = `${item.name} ${column.name}`;

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

  if (isEditing) {
    return (
      <div className="relative flex items-center border-l px-3">
        <CellEditor
          kind={column.kind}
          value={value}
          settings={settings}
          members={members}
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
      className="hover:bg-surface-muted focus-visible:ring-ring flex h-full cursor-pointer items-center truncate border-l px-3 transition-colors focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset"
    >
      <CellRenderer kind={column.kind} value={value} settings={settings} />
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
      <div className="bg-surface sticky left-0 z-10 flex items-center px-4">
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
    <div className="group/name bg-surface hover:bg-surface-muted sticky left-0 z-10 flex h-full items-center pr-2 transition-colors">
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
        className="hover:bg-accent text-muted-foreground hover:text-foreground focus-visible:ring-ring grid size-7 shrink-0 place-items-center rounded-md opacity-0 transition-opacity group-hover/name:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:outline-none"
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
          placeholder="Item name"
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
