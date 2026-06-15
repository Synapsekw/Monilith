"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import type { BoardPayload, Column, Group, Item } from "@/lib/boards/queries";
import type { Json } from "@/types/database.types";
import type { ColumnOption } from "@/lib/validations/boards";
import { createItem, renameItem } from "@/lib/boards/actions";
import { CellRenderer } from "@/components/boards/cells";
import { Input } from "@/components/ui/input";
import {
  CellEditor,
  type EditorMember,
} from "@/components/boards/cells/editors";
import type { BoardCache } from "@/lib/boards/cache";
import { useBoardCache } from "@/lib/boards/use-board-cache";
import { useBoardMutations } from "@/lib/boards/use-board-mutations";
import { useBoardRealtime } from "@/lib/boards/use-board-realtime";

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
};

const ROW_HEIGHT = 40;
const NAME_COL_WIDTH = 280;
const VALUE_COL_WIDTH = 180;

/** CSS grid template: pinned Name column + one track per configurable column. */
function gridTemplate(columnCount: number) {
  return `${NAME_COL_WIDTH}px repeat(${columnCount}, minmax(${VALUE_COL_WIDTH}px, 1fr))`;
}

export function BoardTable({
  payload,
  members = [],
}: {
  payload: BoardPayload;
  members?: EditorMember[];
}) {
  // Hydrate the ["board", boardId] cache once from the server payload; read all
  // board data from the cache so optimistic + realtime patches re-render.
  const { data: cache } = useBoardCache(
    payload.board.id,
    payload as unknown as BoardCache,
  );
  const { board, groups, columns, items, cellValues } = cache;

  const [editing, setEditing] = useState<EditingCell | null>(null);
  const { setCell, clearCellValue } = useBoardMutations(payload.board.id);
  useBoardRealtime(payload.board.id);

  // Cell lookup keyed by `${item_id}:${column_id}` → raw JSON value.
  const cellMap = new Map<string, Json>(
    cellValues.map((c) => [`${c.item_id}:${c.column_id}`, c.value]),
  );

  // Items grouped by group_id, kept in position order (query already sorts).
  const itemsByGroup = new Map<string, Item[]>();
  for (const g of groups) itemsByGroup.set(g.id, []);
  for (const it of items) {
    const bucket = itemsByGroup.get(it.group_id);
    if (bucket) bucket.push(it);
    else itemsByGroup.set(it.group_id, [it]);
  }

  // TanStack Table models the column/header structure (read-only here).
  const tableColumns: ColumnDef<Item>[] = columns.map((col) => ({
    id: col.id,
    header: col.name,
    accessorFn: (row) => cellMap.get(`${row.id}:${col.id}`) ?? null,
  }));
  const table = useReactTable({
    data: items,
    columns: tableColumns,
    getCoreRowModel: getCoreRowModel(),
  });
  const headerGroups = table.getHeaderGroups();

  const template = gridTemplate(columns.length);

  const controls: CellControls = {
    editing,
    setEditing,
    setCell,
    clearCellValue,
    members,
  };

  return (
    <div className="flex h-full flex-col">
      <header className="border-b px-6 py-4">
        <h1 className="text-xl font-semibold tracking-tight">{board.name}</h1>
      </header>

      <div className="flex-1 overflow-auto">
        <div className="min-w-fit">
          {/* Column header row */}
          <div
            className="bg-surface-muted text-muted-foreground sticky top-0 z-20 grid border-b text-xs font-medium"
            style={{ gridTemplateColumns: template }}
          >
            <div className="bg-surface-muted sticky left-0 z-10 truncate px-4 py-2">
              Name
            </div>
            {headerGroups[0]?.headers.map((header) => (
              <div key={header.id} className="truncate border-l px-3 py-2">
                {String(header.column.columnDef.header ?? "")}
              </div>
            ))}
          </div>

          {groups.length === 0 ? (
            <p className="text-muted-foreground px-4 py-6 text-sm">
              This board has no groups yet.
            </p>
          ) : (
            groups.map((group) => (
              <GroupSection
                key={group.id}
                group={group}
                items={itemsByGroup.get(group.id) ?? []}
                columns={columns}
                cellMap={cellMap}
                template={template}
                controls={controls}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function GroupSection({
  group,
  items,
  columns,
  cellMap,
  template,
  controls,
}: {
  group: Group;
  items: Item[];
  columns: Column[];
  cellMap: Map<string, Json>;
  template: string;
  controls: CellControls;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  const virtualRows = virtualizer.getVirtualItems();
  // Cap the scroll viewport so long groups virtualize; short ones shrink.
  const viewportHeight = Math.min(items.length * ROW_HEIGHT, 12 * ROW_HEIGHT);

  return (
    <section>
      {/* Colored band header — group.color tints the left rail + label. */}
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
        className="bg-surface hover:bg-accent focus-visible:ring-ring sticky left-0 flex w-full items-center gap-2 border-b px-3 py-2 text-left text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none"
        style={{ boxShadow: `inset 3px 0 0 0 ${group.color}` }}
      >
        {collapsed ? (
          <ChevronRight className="text-muted-foreground size-4" />
        ) : (
          <ChevronDown className="text-muted-foreground size-4" />
        )}
        <span
          className="inline-block size-2 shrink-0 rounded-full"
          style={{ backgroundColor: group.color }}
          aria-hidden
        />
        <span className="truncate">{group.name}</span>
        <span className="text-muted-foreground text-xs font-normal">
          {items.length}
        </span>
      </button>

      {!collapsed && (
        <>
          {items.length > 0 && (
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
                  return (
                    <div
                      key={item.id}
                      className="hover:bg-accent/50 absolute top-0 left-0 grid w-full border-b transition-colors"
                      style={{
                        height: ROW_HEIGHT,
                        transform: `translateY(${vr.start}px)`,
                        gridTemplateColumns: template,
                      }}
                    >
                      <NameCell item={item} />
                      {columns.map((col) => (
                        <EditableCell
                          key={col.id}
                          item={item}
                          column={col}
                          value={cellMap.get(`${item.id}:${col.id}`) ?? null}
                          controls={controls}
                        />
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <AddItemRow groupId={group.id} />
        </>
      )}
    </section>
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
  value: Json;
  controls: CellControls;
}) {
  const { editing, setEditing, setCell, clearCellValue, members } = controls;
  const isEditing =
    editing?.itemId === item.id && editing.columnId === column.id;
  const settings = (column.settings ?? {}) as Settings;
  const accessibleName = `${item.name} ${column.name}`;

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
      className="hover:bg-accent/60 focus-visible:ring-ring flex h-full cursor-pointer items-center truncate border-l px-3 transition-colors focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset"
    >
      <CellRenderer kind={column.kind} value={value} settings={settings} />
    </div>
  );
}

/**
 * The built-in primary "Name" cell. Click/Enter opens an inline rename input
 * (Enter or blur commits via the `renameItem` action, Esc cancels). An empty
 * name is rejected — it reverts to the current name. The board route revalidates
 * on success, so the new name flows back through the server payload.
 */
function NameCell({ item }: { item: Item }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(item.name);
  const [isPending, startTransition] = useTransition();

  function open() {
    setName(item.name);
    setEditing(true);
  }

  function commit() {
    const trimmed = name.trim();
    setEditing(false);
    if (!trimmed || trimmed === item.name) return;
    startTransition(async () => {
      const res = await renameItem({ itemId: item.id, name: trimmed });
      if (res.ok) router.refresh();
      else setName(item.name);
    });
  }

  if (editing) {
    return (
      <div className="bg-surface sticky left-0 z-10 flex items-center px-4">
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
      className="bg-surface hover:bg-accent/60 focus-visible:ring-ring sticky left-0 z-10 flex h-full cursor-pointer items-center truncate px-4 text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset"
    >
      {item.name}
    </div>
  );
}

function AddItemRow({ groupId }: { groupId: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function commit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setError(null);
    startTransition(async () => {
      const res = await createItem({ groupId, name: trimmed });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setName("");
      setError(null);
      router.refresh();
    });
  }

  return (
    <div
      className="bg-surface sticky left-0 flex flex-col border-b px-4 py-1.5"
      style={{ width: NAME_COL_WIDTH }}
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
