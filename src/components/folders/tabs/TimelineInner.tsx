"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { getFolderTimeline } from "@/lib/folders/actions";
import { assertOnline } from "@/lib/offline/online-status";
import { upsertCell } from "@/lib/boards/actions";
import {
  createDependency,
  deleteDependency,
} from "@/lib/boards/dependency-actions";
import { itemDateRange } from "@/lib/boards/dates";
import { onBarMoved, onBarResized, type SetCellArg } from "@/lib/boards/gantt";
import {
  boardScheduleOf,
  contextCellValues,
  type FolderTimelineData,
} from "@/lib/boards/timeline-context";
import { buildFolderTimeline, folderTimelineKey } from "@/lib/folders/timeline";
import type { TimelineZoom } from "@/components/boards/gantt/utils";
import { GanttCanvas } from "@/components/boards/gantt/GanttCanvas";
import { EmptyState } from "@/components/ui/empty-state";
import { Kicker } from "@/components/ui/kicker";
import { Skeleton } from "@/components/ui/skeleton";

const ZOOMS = ["week", "month", "quarter"] as const;
const ZOOM_LABEL: Record<(typeof ZOOMS)[number], string> = {
  week: "Week",
  month: "Month",
  quarter: "Quarter",
};
const MAX_SHOWN = 5000;
const MAX_LINK_CANDIDATES = 200;

type Props = { folderId: string; stage: string | null; board: string | null };

/**
 * The folder's boards on one editable timeline. One Server Action fetch when
 * the tab first mounts (TanStack Query); zoom, collapse and the folder's
 * stage/board filters re-derive from that cache. Writes patch the cache
 * optimistically and roll back on failure — never a refetch or refresh.
 */
export function TimelineInner({ folderId, stage, board }: Props) {
  const q = useQuery({
    queryKey: folderTimelineKey(folderId),
    queryFn: async () => {
      const res = await getFolderTimeline({ folderId });
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
    staleTime: 60_000,
  });

  if (q.isPending) return <Skeleton className="h-40 w-full" />;
  if (q.isError)
    return (
      <EmptyState variant="inline">
        Couldn&apos;t load the timeline. {q.error.message}
      </EmptyState>
    );
  return (
    <FolderTimelineChart
      folderId={folderId}
      data={q.data}
      stage={stage}
      board={board}
    />
  );
}

/** Patch the cached payload in place (immutably); no-op before it loads. */
function patchData(
  client: QueryClient,
  folderId: string,
  fn: (d: FolderTimelineData) => FolderTimelineData,
) {
  client.setQueryData<FolderTimelineData>(folderTimelineKey(folderId), (d) =>
    d ? fn(d) : d,
  );
}

function setItemDate(
  d: FolderTimelineData,
  itemId: string,
  columnId: string,
  value: unknown,
): FolderTimelineData {
  return {
    ...d,
    items: d.items.map((it) => {
      if (it.id !== itemId) return it;
      const dates = { ...it.dates };
      if (value === undefined) delete dates[columnId];
      else dates[columnId] = value;
      return { ...it, dates };
    }),
  };
}

function FolderTimelineChart({
  folderId,
  data,
  stage,
  board,
}: {
  folderId: string;
  data: FolderTimelineData;
  stage: string | null;
  board: string | null;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [zoom, setZoom] = useState<TimelineZoom>("month");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [collapsedBoards, setCollapsedBoards] = useState<ReadonlySet<string>>(
    new Set(),
  );

  const view = useMemo(
    () =>
      buildFolderTimeline(data, {
        stageKey: stage,
        boardId: board,
        expanded,
        zoom,
        collapsedBoards,
      }),
    [data, stage, board, expanded, zoom, collapsedBoards],
  );

  const boards = useMemo(
    () => new Map(data.boards.map((b) => [b.id, b])),
    [data.boards],
  );
  const groupColor = useMemo(() => {
    const byGroup = new Map<string, string>();
    for (const b of data.boards)
      for (const g of b.groups) byGroup.set(g.id, g.color);
    return new Map(
      data.items.map((i) => [i.id, byGroup.get(i.group_id) ?? null]),
    );
  }, [data.boards, data.items]);
  const cells = useMemo(() => contextCellValues(data.items), [data.items]);

  // A board band whose board has nothing dated says so in its label.
  const rows = useMemo(
    () =>
      view.rows.map((r) =>
        r.kind === "section" &&
        r.itemId.startsWith("board:") &&
        view.noDateBoards.has(r.itemId.slice("board:".length))
          ? { ...r, name: `${r.name} · No dates on this board` }
          : r,
      ),
    [view.rows, view.noDateBoards],
  );
  const rowName = useMemo(
    () => new Map(rows.map((r) => [r.itemId, r.name])),
    [rows],
  );

  // Late links: in-view arrows that break finish-to-start, plus late stubs.
  const lateCount = useMemo(() => {
    const late = new Set(view.violations);
    for (const stubs of view.externalLinks.values())
      for (const s of stubs) if (s.late) late.add(s.dependencyId);
    return late.size;
  }, [view.violations, view.externalLinks]);

  const cellMutation = useMutation({
    mutationFn: async (v: SetCellArg) => {
      assertOnline();
      const res = await upsertCell(v);
      if (!res.ok) throw new Error(res.error);
    },
    onMutate: async (v) => {
      await queryClient.cancelQueries({
        queryKey: folderTimelineKey(folderId),
      });
      const prev = queryClient
        .getQueryData<FolderTimelineData>(folderTimelineKey(folderId))
        ?.items.find((i) => i.id === v.itemId)?.dates[v.columnId];
      patchData(queryClient, folderId, (d) =>
        setItemDate(d, v.itemId, v.columnId, v.value),
      );
      return { prev };
    },
    onError: (err, v, ctx) => {
      // Restore just this cell — a move writes two cells, and the other
      // write may well have landed. Only while the cell still holds THIS
      // write's value: a later drag of the same bar owns it otherwise.
      patchData(queryClient, folderId, (d) => {
        const current = d.items.find((i) => i.id === v.itemId)?.dates[
          v.columnId
        ];
        return JSON.stringify(current) === JSON.stringify(v.value)
          ? setItemDate(d, v.itemId, v.columnId, ctx?.prev)
          : d;
      });
      // A two-cell move fails twice for the same reason — one toast.
      toast.error(err.message, { id: `timeline-write:${v.itemId}` });
    },
  });
  const setCell = useCallback(
    (v: SetCellArg) => cellMutation.mutate(v),
    [cellMutation],
  );

  const scheduleOfItem = (itemId: string) => {
    const b = boards.get(view.boardOfItem.get(itemId) ?? "");
    return b ? boardScheduleOf(b) : null;
  };

  // Every payload item (in view or not) → its board, for link permissions.
  const boardOfAnyItem = useMemo(
    () => new Map(data.items.map((i) => [i.id, i.board_id])),
    [data.items],
  );
  // The DB lets a link be deleted with edit on EITHER end's board.
  function canRemoveDependency(dep: {
    predecessor_id: string;
    successor_id: string;
  }): boolean {
    return [dep.predecessor_id, dep.successor_id].some(
      (id) => !!boards.get(boardOfAnyItem.get(id) ?? "")?.can_edit,
    );
  }

  function canEditItem(itemId: string): boolean {
    const b = boards.get(view.boardOfItem.get(itemId) ?? "");
    return !!b?.can_edit && !boardScheduleOf(b).readOnly;
  }

  function handleMoveBar(itemId: string, deltaDays: number) {
    const s = scheduleOfItem(itemId);
    if (!s?.startSourceId || !canEditItem(itemId)) return;
    const range = itemDateRange(itemId, cells, s.startSourceId);
    if (!range) return;
    onBarMoved(
      itemId,
      deltaDays,
      range,
      s.startSourceId,
      s.endSourceId,
      setCell,
    );
  }

  function handleResizeBar(itemId: string, newEndISO: string) {
    const s = scheduleOfItem(itemId);
    if (!s?.startSourceId || !canEditItem(itemId)) return;
    // Same range the board Gantt uses: the row's own resolved span.
    const row = view.rows.find((r) => r.itemId === itemId);
    const range = { start: row?.startISO ?? "", end: row?.endISO ?? "" };
    onBarResized(
      itemId,
      newEndISO,
      range,
      s.startSourceId,
      s.endSourceId,
      setCell,
    );
  }

  async function handleAddDependency(vars: {
    predecessorId: string;
    successorId: string;
  }) {
    const res = await createDependency(vars);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    patchData(queryClient, folderId, (d) => ({
      ...d,
      dependencies: [
        ...d.dependencies,
        {
          id: res.data.dependencyId,
          predecessor_id: vars.predecessorId,
          successor_id: vars.successorId,
        },
      ],
    }));
  }

  async function handleRemoveDependency({
    dependencyId,
  }: {
    dependencyId: string;
  }) {
    const removed = queryClient
      .getQueryData<FolderTimelineData>(folderTimelineKey(folderId))
      ?.dependencies.find((d) => d.id === dependencyId);
    patchData(queryClient, folderId, (d) => ({
      ...d,
      dependencies: d.dependencies.filter((x) => x.id !== dependencyId),
    }));
    const res = await deleteDependency({ dependencyId });
    if (res.ok) return;
    if (removed)
      patchData(queryClient, folderId, (d) => ({
        ...d,
        dependencies: [...d.dependencies, removed],
      }));
    toast.error(res.error);
  }

  function linkCandidates(row: { itemId: string }) {
    // Drawing a link needs edit on the successor's board (the server checks
    // the same). Synthetic-date boards still take links, so can_edit only.
    if (!boards.get(view.boardOfItem.get(row.itemId) ?? "")?.can_edit)
      return [];
    const already = new Set(
      data.dependencies
        .filter((d) => d.successor_id === row.itemId)
        .map((d) => d.predecessor_id),
    );
    const out: { itemId: string; name: string }[] = [];
    for (const [itemId, boardId] of view.boardOfItem) {
      if (itemId === row.itemId || already.has(itemId)) continue;
      out.push({
        itemId,
        name: `${rowName.get(itemId) ?? ""} · ${boards.get(boardId)?.name ?? ""}`,
      });
    }
    return out
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, MAX_LINK_CANDIDATES);
  }

  // The folder page has no item panel — an item opens on its own board.
  function openItem(boardId: string | undefined, itemId: string) {
    if (boardId) router.push(`/boards/${boardId}?item=${itemId}`);
  }

  function isExpanded(id: string): boolean {
    if (id.startsWith("board:"))
      return !collapsedBoards.has(id.slice("board:".length));
    return expanded.has(id);
  }
  function toggle(id: string) {
    const flip = (set: ReadonlySet<string>, key: string) => {
      const next = new Set(set);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    };
    if (id.startsWith("board:"))
      setCollapsedBoards((s) => flip(s, id.slice("board:".length)));
    else setExpanded((s) => flip(s, id));
  }

  const { boards: boardCount, items: itemCount } = view.totals;

  return (
    <div className="mt-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Kicker>
          {boardCount} {boardCount === 1 ? "board" : "boards"} · {itemCount}{" "}
          {itemCount === 1 ? "item" : "items"}
        </Kicker>
        {lateCount > 0 ? (
          <span className="text-destructive inline-flex items-center gap-1.5 text-xs font-medium">
            <span
              aria-hidden
              className="bg-destructive size-1.5 rounded-full"
            />
            {lateCount} late {lateCount === 1 ? "link" : "links"}
          </span>
        ) : null}
        <div
          role="group"
          aria-label="Zoom"
          className="ml-auto flex items-center gap-1 rounded-md border p-0.5"
        >
          {ZOOMS.map((z) => (
            <button
              key={z}
              type="button"
              aria-pressed={zoom === z}
              onClick={() => setZoom(z)}
              className={cn(
                "focus-visible:ring-ring rounded px-2.5 py-1 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none pointer-coarse:min-h-11 pointer-coarse:px-3",
                zoom === z
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-state-hover",
              )}
            >
              {ZOOM_LABEL[z]}
            </button>
          ))}
        </div>
      </div>
      {data.truncated ? (
        <p className="text-muted-foreground text-xs">
          {`Showing the first ${(data.total_items > MAX_SHOWN ? MAX_SHOWN : data.total_items).toLocaleString("en-US")} of ${data.total_items.toLocaleString("en-US")} items`}
        </p>
      ) : null}
      {rows.length === 0 ? (
        <EmptyState variant="inline">No boards match these filters.</EmptyState>
      ) : (
        <div className="bg-surface flex h-[min(72vh,760px)] min-h-80 flex-col overflow-hidden rounded-lg border">
          <GanttCanvas
            rows={rows}
            dependencies={view.dependencies}
            violations={view.violations}
            externalLinks={view.externalLinks}
            rangeStartISO={view.rangeStartISO}
            dayCount={view.dayCount}
            zoom={zoom}
            colorFor={(row) => groupColor.get(row.itemId) ?? null}
            canEditItem={canEditItem}
            isExpanded={isExpanded}
            onToggleExpand={toggle}
            onMoveBar={handleMoveBar}
            onResizeBar={handleResizeBar}
            onAddDependency={(v) => void handleAddDependency(v)}
            onRemoveDependency={(v) => void handleRemoveDependency(v)}
            canRemoveDependency={canRemoveDependency}
            linkCandidates={linkCandidates}
            onItemTap={(itemId) =>
              openItem(view.boardOfItem.get(itemId), itemId)
            }
            onStubTap={(stub) => openItem(stub.boardId, stub.itemId)}
          />
        </div>
      )}
    </div>
  );
}
