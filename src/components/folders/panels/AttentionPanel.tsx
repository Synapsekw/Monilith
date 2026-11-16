"use client";

import { useState } from "react";
import Link from "next/link";
import { useInfiniteQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { getFolderAttention } from "@/lib/folders/actions";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusPill, type StatusColor } from "@/components/ui/status-pill";
import type { AttentionGroup } from "@/lib/folders/tower";
import type { AttentionReason, AttentionRow } from "@/lib/folders/types";
import { cn } from "@/lib/utils";
import { Failed, Panel } from "./Panel";

const REASON_COLOR: Record<AttentionReason, StatusColor> = {
  overdue: "red",
  blocked: "red",
  unassigned: "yellow",
  stale: "gray",
};

function ItemRow({ a, withBoard }: { a: AttentionRow; withBoard: boolean }) {
  return (
    <li className="flex items-center gap-3 py-2 text-xs">
      <StatusPill
        color={REASON_COLOR[a.reason]}
        variant="soft"
        className="w-24 justify-center"
      >
        {a.reason}
      </StatusPill>
      <Link
        href={`/boards/${a.boardId}?item=${a.itemId}`}
        className="hover:text-foreground min-w-0 flex-1 truncate font-medium"
      >
        {a.itemName}
      </Link>
      <span className="text-muted-foreground truncate">
        {withBoard ? a.boardName : null}
        {a.groupName ? `${withBoard ? " · " : ""}${a.groupName.trim()}` : ""}
      </span>
      <span className="text-muted-foreground font-mono tabular-nums">
        {a.reason} · {a.ageDays}d
      </span>
    </li>
  );
}

function facts(g: AttentionGroup): string {
  const parts = [
    g.overdue > 0 ? `${g.overdue} overdue` : null,
    g.blocked > 0 ? `${g.blocked} blocked` : null,
    g.unassigned > 0 ? `${g.unassigned} unassigned` : null,
    g.stale > 0 ? `${g.stale} stale` : null,
    g.oldestOverdueDays !== null ? `oldest ${g.oldestOverdueDays}d` : null,
  ].filter((p): p is string => p !== null);
  return parts.join(" · ");
}

/** Tells the reader the list under a board is a sample. The reason counts
 *  overlap (one item can be overdue and blocked) while each row carries one
 *  reason, so there is no distinct total. The board's largest single-reason
 *  count is a floor on it: fewer rows than that means some are not listed. */
function CutNotice({ g }: { g: AttentionGroup }) {
  const atLeast = Math.max(g.overdue, g.blocked, g.unassigned, g.stale);
  const shown = g.items.length;
  if (shown >= atLeast) return null;
  return (
    <p
      data-testid="attention-cut"
      className="text-muted-foreground py-2 text-xs"
    >
      Showing {shown} of at least {atLeast}.{" "}
      <Link
        href={`/boards/${g.boardId}`}
        className="hover:text-foreground underline"
      >
        Open the board for all.
      </Link>
    </p>
  );
}

/** Rows per request when a board's list is read on demand. */
export const ATTENTION_PAGE = 20;

/** Where a board's rows come from when the first-paint sample is not the
 *  whole list: the folder, and the stage the page is filtered to. */
export type AttentionRemote = { folderId: string; stage: string | null };

/**
 * One board's attention rows, read when the board is expanded: the board and
 * stage filters run INSIDE the query, so the limit applies to matching rows
 * and `total` counts all of them ("Showing 20 of 143"). `total` is null only
 * against a database that cannot filter in the query yet; the list is then
 * what the folder's 100 most urgent rows hold for this board, and says so.
 */
function RemoteItems({
  boardId,
  remote,
}: {
  boardId: string;
  remote: AttentionRemote;
}) {
  const q = useInfiniteQuery({
    queryKey: ["folder-attention", remote.folderId, boardId, remote.stage],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const res = await getFolderAttention({
        folderId: remote.folderId,
        boardId,
        stageKey: remote.stage,
        limit: ATTENTION_PAGE,
        offset: pageParam,
      });
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((s, p) => s + p.rows.length, 0);
      if (last.rows.length === 0) return undefined;
      // Unknown total: another page exists only if this one came back full.
      if (last.total === null)
        return last.rows.length < ATTENTION_PAGE ? undefined : loaded;
      return loaded >= last.total ? undefined : loaded;
    },
    staleTime: 60_000,
  });
  if (q.isPending)
    return (
      <Skeleton data-testid="attention-skeleton" className="my-2 h-16 w-full" />
    );
  const seen = new Set<string>();
  const rows = (q.data?.pages ?? [])
    .flatMap((p) => p.rows)
    .filter((r) => (seen.has(r.itemId) ? false : (seen.add(r.itemId), true)));
  if (q.isError && rows.length === 0)
    return (
      <div className="flex flex-col items-start gap-2 py-2">
        <p className="text-muted-foreground text-xs">
          Couldn&apos;t load this board&apos;s items. {q.error.message}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void q.refetch()}
        >
          Retry
        </Button>
      </div>
    );
  const total = q.data?.pages.at(-1)?.total ?? null;
  if (rows.length === 0)
    return (
      <p className="text-muted-foreground py-2 text-xs">
        {total === null
          ? "None of this board's items are among the folder's 100 most urgent. "
          : "Nothing on this board needs attention right now. "}
        <Link
          href={`/boards/${boardId}`}
          className="hover:text-foreground underline"
        >
          Open the board
        </Link>
      </p>
    );
  return (
    <>
      <ul className="divide-y">
        {rows.map((a) => (
          <ItemRow key={a.itemId} a={a} withBoard={false} />
        ))}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-2 py-2">
        <p
          data-testid="attention-count"
          className="text-muted-foreground text-xs"
        >
          {total === null ? (
            <>
              Showing {rows.length} from the folder&apos;s 100 most urgent
              items; this board may have more.{" "}
              <Link
                href={`/boards/${boardId}`}
                className="hover:text-foreground underline"
              >
                Open the board for all.
              </Link>
            </>
          ) : (
            `Showing ${rows.length} of ${total}.`
          )}
        </p>
        {q.hasNextPage ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={q.isFetchingNextPage}
            onClick={() => void q.fetchNextPage()}
          >
            {q.isFetchingNextPage
              ? "Loading…"
              : total === null
                ? "Show more"
                : `Show ${Math.min(ATTENTION_PAGE, total - rows.length)} more`}
          </Button>
        ) : null}
      </div>
      {q.isError ? (
        <p role="alert" className="text-destructive text-xs">
          Couldn&apos;t load more. {q.error.message}
        </p>
      ) : null}
    </>
  );
}

function Group({ g, remote }: { g: AttentionGroup; remote?: AttentionRemote }) {
  const [open, setOpen] = useState(false);
  const panelId = `attention-${g.boardId}`;
  return (
    <li data-testid="attention-group" className="py-1">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="hover:bg-state-hover focus-visible:ring-ring flex w-full items-center gap-2 rounded-sm px-1 py-1.5 text-left text-xs outline-none focus-visible:ring-2 pointer-coarse:min-h-11"
      >
        <ChevronRight
          aria-hidden
          className={cn(
            "size-3.5 shrink-0 transition-transform",
            open && "rotate-90",
          )}
        />
        <span className="min-w-0 flex-1 truncate font-medium">
          {g.boardName}
        </span>
        <span className="text-muted-foreground font-mono tabular-nums">
          {facts(g)}
        </span>
      </button>
      <div id={panelId} hidden={!open} className="pl-6">
        {open ? (
          remote ? (
            <RemoteItems boardId={g.boardId} remote={remote} />
          ) : g.items.length === 0 ? (
            <p className="text-muted-foreground py-2 text-xs">
              None of this board&apos;s items are in the top of the list.{" "}
              <Link
                href={`/boards/${g.boardId}`}
                className="hover:text-foreground underline"
              >
                Open the board
              </Link>
            </p>
          ) : (
            <>
              <ul className="divide-y">
                {g.items.map((a) => (
                  <ItemRow key={a.itemId} a={a} withBoard={false} />
                ))}
              </ul>
              <CutNotice g={g} />
            </>
          )
        ) : null}
      </div>
    </li>
  );
}

/**
 * "Needs attention". With `groups` it is one row per board carrying the
 * rollup's counts (totals, not a sample), each expanding in place to the part
 * of the top-N sample on that board. Without `groups` it is the flat list.
 *
 * With `remote` (the first-paint sample is NOT the folder's whole list), a
 * board's rows are not taken from the sample at all: expanding it reads that
 * board's rows, filtered in the query, a page at a time.
 */
export function AttentionPanel({
  kicker,
  title = "Needs attention",
  attention,
  caption,
  groups,
  remote,
  onRetry,
}: {
  kicker: string;
  title?: string;
  attention: AttentionRow[] | null;
  caption: string | null;
  groups?: AttentionGroup[] | null;
  remote?: AttentionRemote;
  onRetry: () => void;
}) {
  const grouped = groups !== undefined;
  return (
    <Panel kicker={kicker} title={title}>
      {caption ? (
        <p
          data-testid="attention-caption"
          className="text-muted-foreground text-xs"
        >
          {caption}
        </p>
      ) : null}
      {attention === null || groups === null ? (
        <Failed onRetry={onRetry} />
      ) : grouped ? (
        groups.length === 0 ? (
          <EmptyState variant="inline">Nothing needs attention.</EmptyState>
        ) : (
          <ul className="divide-y">
            {groups.map((g) => (
              <Group
                // A new stage is a new list: collapse and start over.
                key={`${g.boardId}:${remote?.stage ?? ""}`}
                g={g}
                remote={remote}
              />
            ))}
          </ul>
        )
      ) : attention.length === 0 ? (
        <EmptyState variant="inline">Nothing needs attention.</EmptyState>
      ) : (
        <ul className="divide-y">
          {attention.map((a) => (
            <ItemRow key={a.itemId} a={a} withBoard />
          ))}
        </ul>
      )}
    </Panel>
  );
}
