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
import { createItem } from "@/lib/boards/actions";
import { CellRenderer } from "@/components/boards/cells";

type Settings = Record<string, unknown> & { options?: ColumnOption[] };

const ROW_HEIGHT = 40;
const NAME_COL_WIDTH = 280;
const VALUE_COL_WIDTH = 180;

/** CSS grid template: pinned Name column + one track per configurable column. */
function gridTemplate(columnCount: number) {
  return `${NAME_COL_WIDTH}px repeat(${columnCount}, minmax(${VALUE_COL_WIDTH}px, 1fr))`;
}

export function BoardTable({ payload }: { payload: BoardPayload }) {
  const { board, groups, columns, items, cellValues } = payload;

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
}: {
  group: Group;
  items: Item[];
  columns: Column[];
  cellMap: Map<string, Json>;
  template: string;
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
                      <div className="bg-surface sticky left-0 z-10 flex items-center truncate px-4 text-sm">
                        {item.name}
                      </div>
                      {columns.map((col) => (
                        <div
                          key={col.id}
                          className="flex items-center truncate border-l px-3"
                        >
                          <CellRenderer
                            kind={col.kind}
                            value={cellMap.get(`${item.id}:${col.id}`) ?? null}
                            settings={(col.settings ?? {}) as Settings}
                          />
                        </div>
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
