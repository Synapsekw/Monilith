"use client";

import { useMemo, useRef, useState, type MouseEvent } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, Plus, Search, TriangleAlert, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kicker } from "@/components/ui/kicker";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  addDependency,
  removeDependency,
  type BoardCache,
} from "@/lib/boards/cache";
import { boardKey } from "@/lib/boards/use-board-cache";
import { useDependencyContext } from "@/lib/boards/use-dependency-context";
import {
  createDependency,
  deleteDependency,
  searchDependencyTargets,
  type DependencyTarget,
} from "@/lib/boards/dependency-actions";
import {
  isSyntheticDateSource,
  resolveTimelineSpan,
  syntheticDateCellValues,
  type TimelineSpan,
} from "@/lib/boards/dates";
import {
  resolveBoardSchedule,
  type TimelineViewConfig,
} from "@/lib/boards/schedule";
import { contextSpans } from "@/lib/boards/timeline-context";
import {
  buildDependencyList,
  type DependencyEntry,
} from "@/lib/boards/dependency-list";
import { isoToLocalDate } from "@/lib/boards/iso-date";
import { useDebouncedCallback } from "@/lib/hooks/use-debounced-callback";

type Direction = "waitingOn" | "blocking";

const MIN_QUERY = 2;

/**
 * "Waiting on / Blocking" item-panel section. Reads the live board cache (no
 * fetch of its own — the board already hydrated it) plus the foreign ends of
 * cross-board links via `useDependencyContext`, which only round-trips when
 * such a link exists. Adding searches the whole org (RLS-scoped); the realtime
 * echo puts the new row into the board cache, and a new cross-board row bumps
 * `useDependencyContext`'s key so the foreign end loads once — no manual
 * invalidate. Removing is optimistic with a rollback on error.
 */
export function DependenciesSection({
  itemId,
  boardId,
  boardName,
  schedule,
  canEdit,
}: {
  itemId: string;
  boardId: string;
  boardName: string;
  schedule: TimelineViewConfig;
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  // Subscribe to the board cache without ever fetching it from here.
  const { data: cache } = useQuery<BoardCache>({
    queryKey: boardKey(boardId),
    enabled: false,
  });
  const dependencies = cache?.dependencies ?? [];
  const ctx = useDependencyContext(boardId, dependencies);

  const lists = useMemo(() => {
    if (!cache) return null;
    const dateCols = cache.columns
      .filter((c) => c.kind === "date")
      .map((c) => ({ id: c.id, name: c.name }));
    const s = resolveBoardSchedule(dateCols, schedule);
    // Spans only for this item and the local items linked to it.
    const wanted = new Set<string>([itemId]);
    for (const d of cache.dependencies) {
      if (d.successor_id === itemId) wanted.add(d.predecessor_id);
      if (d.predecessor_id === itemId) wanted.add(d.successor_id);
    }
    const synthetic = [s.startSourceId, s.endSourceId].filter(
      (id): id is string => isSyntheticDateSource(id),
    );
    const cells = synthetic.length
      ? [
          ...cache.cellValues,
          ...syntheticDateCellValues(
            cache.items.filter((i) => wanted.has(i.id)),
            synthetic,
          ),
        ]
      : cache.cellValues;
    const localSpans = new Map<string, TimelineSpan | null>();
    for (const id of wanted) {
      localSpans.set(
        id,
        s.startSourceId
          ? resolveTimelineSpan(id, cells, s.startSourceId, s.endSourceId)
          : null,
      );
    }
    const context = ctx.data ?? { boards: [], items: [] };
    return buildDependencyList({
      itemId,
      dependencies: cache.dependencies,
      localItems: cache.items,
      localBoard: { id: boardId, name: boardName },
      localSpans,
      context,
      contextSpans: contextSpans(context),
    });
  }, [cache, ctx.data, itemId, boardId, boardName, schedule]);

  if (!cache || !lists) return null;

  // From the raw rows, not the lists: a foreign end whose context hasn't
  // loaded yet is missing from the lists but is still linked.
  const linkedIds = new Set<string>([itemId]);
  for (const d of cache.dependencies) {
    if (d.successor_id === itemId) linkedIds.add(d.predecessor_id);
    if (d.predecessor_id === itemId) linkedIds.add(d.successor_id);
  }
  // The DB lets a link be deleted with edit on EITHER board, so a foreign
  // link is removable when the viewer can edit the other board.
  const foreignEditable = new Set(
    (ctx.data?.boards ?? []).filter((b) => b.can_edit).map((b) => b.id),
  );
  const canRemove = (e: DependencyEntry) =>
    canEdit || (!e.local && foreignEditable.has(e.boardId));

  async function remove(entry: DependencyEntry) {
    const key = boardKey(boardId);
    const prior = qc
      .getQueryData<BoardCache>(key)
      ?.dependencies.find((d) => d.id === entry.dependencyId);
    qc.setQueryData<BoardCache>(key, (prev) =>
      prev ? removeDependency(prev, entry.dependencyId) : prev,
    );
    const restore = () => {
      if (prior)
        qc.setQueryData<BoardCache>(key, (prev) =>
          prev ? addDependency(prev, prior) : prev,
        );
    };
    try {
      const res = await deleteDependency({
        dependencyId: entry.dependencyId,
      });
      if (!res.ok) {
        restore();
        toast.error(res.error);
      }
    } catch {
      restore();
      toast.error("Couldn't remove the dependency. Check your connection.");
    }
  }

  return (
    <section className="space-y-4 border-t pt-4">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-1">
          <Kicker index="LINKS">Dependencies</Kicker>
          <p className="text-muted-foreground text-xs">
            Work that has to finish first, and work that waits on this.
          </p>
        </div>
        {canEdit && <AddDependency itemId={itemId} excludeIds={linkedIds} />}
      </div>
      <DependencyList
        title="Waiting on"
        empty="Not waiting on anything."
        entries={lists.waitingOn}
        boardId={boardId}
        canRemove={canRemove}
        onRemove={remove}
      />
      <DependencyList
        title="Blocking"
        empty="Nothing waits on this item."
        entries={lists.blocking}
        boardId={boardId}
        canRemove={canRemove}
        onRemove={remove}
      />
    </section>
  );
}

function DependencyList({
  title,
  empty,
  entries,
  boardId,
  canRemove,
  onRemove,
}: {
  title: string;
  empty: string;
  entries: DependencyEntry[];
  boardId: string;
  canRemove: (entry: DependencyEntry) => boolean;
  onRemove: (entry: DependencyEntry) => void;
}) {
  const headingId = `deps-${title.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <section aria-labelledby={headingId} className="space-y-1.5">
      <h3
        id={headingId}
        className="text-foreground flex items-baseline gap-2 text-sm font-semibold"
      >
        {title}
        {entries.length > 0 && (
          <span
            aria-hidden
            className="text-kicker font-mono text-xs font-normal tabular-nums"
          >
            {String(entries.length).padStart(2, "0")}
          </span>
        )}
      </h3>
      {entries.length === 0 ? (
        <p className="text-muted-foreground text-xs">{empty}</p>
      ) : (
        <ul className="space-y-1.5">
          {entries.map((e) => (
            <li key={e.dependencyId}>
              <DependencyRow
                entry={e}
                foreign={e.boardId !== boardId}
                canRemove={canRemove(e)}
                onRemove={() => onRemove(e)}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function formatEnd(iso: string): string {
  return isoToLocalDate(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/** Open a same-board item in the panel via the History API (no RSC refetch). */
function openLocal(e: MouseEvent<HTMLAnchorElement>, itemId: string) {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  e.preventDefault();
  const url = new URL(window.location.href);
  url.searchParams.set("item", itemId);
  window.history.pushState({}, "", url);
}

function DependencyRow({
  entry,
  foreign,
  canRemove,
  onRemove,
}: {
  entry: DependencyEntry;
  foreign: boolean;
  canRemove: boolean;
  onRemove: () => void;
}) {
  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span className="text-foreground block truncate text-sm font-medium">
          {entry.itemName}
        </span>
        <span className="text-kicker flex min-w-0 items-center gap-1.5 text-xs">
          <span className="truncate">{entry.boardName}</span>
          {entry.endISO && (
            <>
              <span aria-hidden>·</span>
              <span className="shrink-0 tabular-nums">
                ends {formatEnd(entry.endISO)}
              </span>
            </>
          )}
        </span>
      </span>
      {entry.late && (
        <span className="text-destructive inline-flex shrink-0 items-center gap-1 text-xs font-medium">
          <TriangleAlert className="size-3.5" aria-hidden />
          Late
        </span>
      )}
      {foreign && (
        <ArrowUpRight
          className="text-muted-foreground group-hover:text-foreground size-4 shrink-0 transition-colors"
          aria-hidden
        />
      )}
    </>
  );
  const linkClass =
    "focus-visible:ring-ring flex min-w-0 flex-1 items-center gap-3 rounded-lg px-3 py-2 focus-visible:ring-2 focus-visible:outline-none";
  return (
    <div
      className={cn(
        "group border-border hover:border-border-hover bg-surface hover:bg-surface-muted ease-keystone flex items-center gap-1 rounded-lg border pr-1 transition-colors",
        entry.late && "border-l-destructive border-l-2",
      )}
    >
      {foreign ? (
        <Link
          href={`/boards/${entry.boardId}?item=${entry.itemId}`}
          className={linkClass}
        >
          {body}
        </Link>
      ) : (
        <a
          href={`?item=${entry.itemId}`}
          onClick={(e) => openLocal(e, entry.itemId)}
          className={linkClass}
        >
          {body}
        </a>
      )}
      {canRemove && (
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-foreground size-7 shrink-0 pointer-coarse:size-11"
          aria-label={`Remove link to ${entry.itemName}`}
          onClick={onRemove}
        >
          <X className="size-3.5" aria-hidden />
        </Button>
      )}
    </div>
  );
}

function AddDependency({
  itemId,
  excludeIds,
}: {
  itemId: string;
  excludeIds: ReadonlySet<string>;
}) {
  const [open, setOpen] = useState(false);
  const [direction, setDirection] = useState<Direction>("waitingOn");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DependencyTarget[]>([]);
  // The term `results` belong to — "No items found." only once it matches.
  const [resolvedTerm, setResolvedTerm] = useState("");
  const [pending, setPending] = useState(false);
  // Only the latest issued search may commit its results.
  const requestId = useRef(0);

  const runSearch = useDebouncedCallback(async (term: string) => {
    const id = ++requestId.current;
    let hits: DependencyTarget[];
    try {
      hits = await searchDependencyTargets(term);
    } catch {
      hits = [];
    }
    if (requestId.current !== id) return;
    setResults(hits);
    setResolvedTerm(term);
  }, 200);

  function onQuery(value: string) {
    setQuery(value);
    const term = value.trim();
    if (term.length < MIN_QUERY) {
      runSearch.cancel();
      requestId.current += 1;
      setResults([]);
      return;
    }
    runSearch(term);
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      runSearch.cancel();
      requestId.current += 1;
      setQuery("");
      setResults([]);
      setResolvedTerm("");
    }
  }

  async function pick(hit: DependencyTarget) {
    setPending(true);
    try {
      const res = await createDependency(
        direction === "waitingOn"
          ? { predecessorId: hit.id, successorId: itemId }
          : { predecessorId: itemId, successorId: hit.id },
      );
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      onOpenChange(false);
    } catch {
      toast.error("Couldn't add the dependency. Check your connection.");
    } finally {
      setPending(false);
    }
  }

  const visible = results.filter((r) => !excludeIds.has(r.id));
  const term = query.trim();
  const emptyText =
    term.length < MIN_QUERY
      ? "Type at least 2 characters."
      : resolvedTerm === term
        ? "No items found."
        : "Searching…";

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="shrink-0">
          <Plus className="size-3.5" aria-hidden />
          Add dependency
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="space-y-2 border-b p-2">
          <div
            role="radiogroup"
            aria-label="Link direction"
            className="bg-surface-sunken grid grid-cols-2 gap-1 rounded-md p-1"
          >
            {(
              [
                ["waitingOn", "Waiting on"],
                ["blocking", "Blocking"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={direction === value}
                onClick={() => setDirection(value)}
                className={cn(
                  "focus-visible:ring-ring ease-keystone rounded-sm px-2 py-1 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none pointer-coarse:min-h-11",
                  direction === value
                    ? "bg-surface text-foreground border-border-bright border"
                    : "text-muted-foreground hover:text-foreground border border-transparent",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 px-1">
            <Search
              className="text-muted-foreground size-4 shrink-0"
              aria-hidden
            />
            <Input
              type="search"
              autoFocus
              value={query}
              onChange={(e) => onQuery(e.target.value)}
              placeholder="Search items in any board…"
              aria-label="Search items to link"
              className="h-8 border-0 px-0 shadow-none focus-visible:ring-0"
            />
          </div>
        </div>
        <ul className="max-h-64 overflow-y-auto py-1" aria-busy={pending}>
          {visible.map((hit) => {
            // Blocking makes the picked item the successor, and the server
            // requires edit access on the successor's board.
            const readOnly = direction === "blocking" && !hit.canEdit;
            return (
              <li key={hit.id}>
                <button
                  type="button"
                  disabled={pending || readOnly}
                  onClick={() => void pick(hit)}
                  aria-label={
                    readOnly
                      ? `${hit.name} · ${hit.boardName} (view only)`
                      : `${hit.name} · ${hit.boardName}`
                  }
                  className="hover:bg-state-hover focus-visible:bg-state-hover flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent pointer-coarse:min-h-11"
                >
                  <span className="min-w-0 flex-1 truncate">
                    {hit.name}
                    <span className="text-muted-foreground">
                      {" "}
                      · {hit.boardName}
                    </span>
                  </span>
                  {readOnly && (
                    <span className="text-muted-foreground shrink-0 text-xs">
                      View only
                    </span>
                  )}
                </button>
              </li>
            );
          })}
          {direction === "blocking" && visible.some((h) => !h.canEdit) && (
            <li className="text-muted-foreground border-t px-3 py-2 text-xs">
              Only items on boards you can edit can wait on this one.
            </li>
          )}
          {visible.length === 0 && (
            <li className="text-muted-foreground px-3 py-3 text-xs">
              {emptyText}
            </li>
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
