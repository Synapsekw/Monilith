"use client";

import Link from "next/link";
import { useInfiniteQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { getFolderKpiItems } from "@/lib/folders/actions";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Kicker } from "@/components/ui/kicker";
import { Skeleton } from "@/components/ui/skeleton";
import { daysBetween } from "@/lib/folders/rollup";
import { fmtDay } from "@/lib/folders/tower";
import type { KpiItemKind, KpiItemRow } from "@/lib/folders/types";

/** Items per request. The function itself never returns more than 100. */
export const KPI_PAGE = 50;

export const kpiItemsKey = (
  folderId: string,
  kind: KpiItemKind,
  board: string | null,
  stage: string | null,
) => ["folder-kpi-items", folderId, kind, board, stage] as const;

/** The one fact about an item that explains why it is in THIS list. */
export function itemFact(
  kind: KpiItemKind,
  r: KpiItemRow,
  todayISO: string,
): string {
  if (kind === "done" || kind === "done_dated")
    return r.doneOn ? `done ${fmtDay(r.doneOn, todayISO)}` : "done";
  if (kind === "stale" && r.lastTouched) {
    const d = daysBetween(r.lastTouched.slice(0, 10), todayISO);
    return `untouched ${Math.max(0, d)}d`;
  }
  if (r.dueOn === null) return "no due date";
  if (r.isOverdue)
    return `due ${fmtDay(r.dueOn, todayISO)} · ${daysBetween(r.dueOn, todayISO)}d late`;
  return `due ${fmtDay(r.dueOn, todayISO)}`;
}

/**
 * The items behind one KPI card, opened in place under the KPI row. Nothing
 * is read until this mounts (the click); then one bounded page per request,
 * and "Show more" asks for the next. `total` is the count of ALL matching
 * items, from the same per-item flags the card's number is counted from, so
 * it equals `expected` unless the folder changed after the page loaded; that
 * case is stated, never hidden.
 */
export function KpiDrilldown({
  id,
  folderId,
  kind,
  title,
  expected,
  stage,
  board,
  todayISO,
  onClose,
}: {
  id: string;
  folderId: string;
  kind: KpiItemKind;
  title: string;
  /** The number on the card. */
  expected: number;
  stage: string | null;
  board: string | null;
  todayISO: string;
  onClose: () => void;
}) {
  const q = useInfiniteQuery({
    queryKey: kpiItemsKey(folderId, kind, board, stage),
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const res = await getFolderKpiItems({
        folderId,
        kpi: kind,
        boardId: board,
        stageKey: stage,
        limit: KPI_PAGE,
        offset: pageParam,
      });
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((s, p) => s + p.rows.length, 0);
      return last.rows.length === 0 || loaded >= last.total
        ? undefined
        : loaded;
    },
    staleTime: 60_000,
  });

  // An item that moved between two requests could arrive twice: keep the first.
  const seen = new Set<string>();
  const rows = (q.data?.pages ?? [])
    .flatMap((p) => p.rows)
    .filter((r) => (seen.has(r.itemId) ? false : (seen.add(r.itemId), true)));
  const total = q.data?.pages.at(-1)?.total ?? null;
  const left = total === null ? 0 : Math.max(0, total - rows.length);

  return (
    <section
      id={id}
      data-testid="kpi-items"
      aria-label={`${title}: items`}
      className="bg-surface animate-fadein flex flex-col gap-3 rounded-lg border p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <Kicker>Items behind the number</Kicker>
          <h3 className="text-sm font-semibold">{title}</h3>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Close the list"
          onClick={onClose}
        >
          <X aria-hidden />
        </Button>
      </div>
      {q.isPending ? (
        <Skeleton data-testid="kpi-items-skeleton" className="h-32 w-full" />
      ) : q.isError && rows.length === 0 ? (
        <div className="flex flex-col items-start gap-2">
          <EmptyState variant="inline">
            Couldn&apos;t load these items. {q.error.message}
          </EmptyState>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void q.refetch()}
          >
            Retry
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <EmptyState variant="inline">No items match right now.</EmptyState>
      ) : (
        <>
          <ul className="divide-y">
            {rows.map((r) => (
              <li
                key={r.itemId}
                data-testid="kpi-item"
                className="flex items-center gap-3 py-2 text-xs"
              >
                <Link
                  href={`/boards/${r.boardId}?item=${r.itemId}`}
                  className="hover:text-foreground focus-visible:ring-ring min-w-0 flex-1 truncate rounded-sm font-medium outline-none focus-visible:ring-2"
                >
                  {r.itemName}
                </Link>
                <span className="text-muted-foreground max-w-[45%] truncate">
                  {r.boardName}
                  {r.groupName ? ` · ${r.groupName.trim()}` : ""}
                </span>
                <span className="text-muted-foreground shrink-0 font-mono tabular-nums">
                  {itemFact(kind, r, todayISO)}
                </span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p
              data-testid="kpi-items-count"
              className="text-muted-foreground text-xs"
            >
              Showing {rows.length} of {total ?? rows.length}.
              {total !== null && total !== expected
                ? ` The card says ${expected}: the folder changed after this page loaded. Reload to update the cards.`
                : ""}
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
                  : `Show ${Math.min(KPI_PAGE, left)} more`}
              </Button>
            ) : null}
          </div>
          {q.isError ? (
            <p role="alert" className="text-destructive text-xs">
              Couldn&apos;t load more. {q.error.message}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
