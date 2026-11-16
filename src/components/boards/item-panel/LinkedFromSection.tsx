"use client";

import type { MouseEvent } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kicker } from "@/components/ui/kicker";
import { Skeleton } from "@/components/ui/skeleton";
import {
  listItemBacklinks,
  type ItemBacklink,
} from "@/lib/boards/item-backlinks";

export const itemBacklinksKey = (itemId: string) =>
  ["item-backlinks", itemId] as const;

/** Open a same-board item in the panel via the History API (no RSC refetch). */
function openLocal(e: MouseEvent<HTMLAnchorElement>, itemId: string) {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  e.preventDefault();
  const url = new URL(window.location.href);
  url.searchParams.set("item", itemId);
  window.history.pushState({}, "", url);
}

const ROW_CLASS =
  "group border-border hover:border-border-hover bg-surface hover:bg-surface-muted ease-keystone focus-visible:ring-ring flex items-center gap-3 rounded-lg border px-3 py-2 transition-colors focus-visible:ring-2 focus-visible:outline-none pointer-coarse:min-h-11";

/**
 * "Linked from": the items whose relation columns point at this item. The
 * board payload only carries links this board OWNS, so the reverse direction
 * is its own read: one bounded, indexed, RLS-scoped query
 * (`listItemBacklinks`) that runs when this section mounts — i.e. when the
 * panel's Fields tab opens — and never on board first paint. Cached per item
 * for a minute, so flipping tabs does not ask again.
 */
export function LinkedFromSection({
  itemId,
  boardId,
}: {
  itemId: string;
  /** The open board: a link from it opens in place instead of navigating. */
  boardId: string;
}) {
  const query = useQuery({
    queryKey: itemBacklinksKey(itemId),
    queryFn: async () => {
      const res = await listItemBacklinks(itemId);
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
    staleTime: 60_000,
  });

  return (
    <section
      aria-labelledby="linked-from-heading"
      className="space-y-3 border-t pt-4"
    >
      <div className="space-y-1">
        <h3 id="linked-from-heading">
          <Kicker index="RELATIONS">Linked from</Kicker>
        </h3>
        <p className="text-muted-foreground text-xs">
          Items that point to this one through a relation column.
        </p>
      </div>

      {query.isPending ? (
        <div
          className="space-y-2"
          aria-busy="true"
          aria-label="Loading linked items"
        >
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-2/3" />
        </div>
      ) : query.isError ? (
        <div role="alert" className="flex items-center justify-between gap-3">
          <p className="text-muted-foreground text-sm">
            Could not load linked items.
          </p>
          <Button variant="outline" size="sm" onClick={() => query.refetch()}>
            Try again
          </Button>
        </div>
      ) : query.data.links.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No items link to this one yet.
        </p>
      ) : (
        <>
          <ul className="space-y-1.5">
            {query.data.links.map((link) => (
              <li key={link.linkId}>
                <BacklinkRow link={link} local={link.boardId === boardId} />
              </li>
            ))}
          </ul>
          {query.data.hasMore && (
            <p className="text-muted-foreground text-xs">
              Showing the {query.data.links.length} most recent links.
            </p>
          )}
        </>
      )}
    </section>
  );
}

function BacklinkRow({ link, local }: { link: ItemBacklink; local: boolean }) {
  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span className="text-foreground block truncate text-sm font-medium">
          {link.itemName}
        </span>
        <span className="text-kicker flex min-w-0 items-center gap-1.5 text-xs">
          <span className="truncate">{link.boardName}</span>
          <span aria-hidden>·</span>
          <span className="truncate">{link.columnName}</span>
        </span>
      </span>
      {!local && (
        <ArrowUpRight
          className="text-muted-foreground group-hover:text-foreground size-4 shrink-0 transition-colors"
          aria-hidden
        />
      )}
    </>
  );
  const label = `Open ${link.itemName} on ${link.boardName}`;
  return local ? (
    <a
      href={`?item=${link.itemId}`}
      onClick={(e) => openLocal(e, link.itemId)}
      aria-label={label}
      className={ROW_CLASS}
    >
      {body}
    </a>
  ) : (
    <Link
      href={`/boards/${link.boardId}?item=${link.itemId}`}
      aria-label={label}
      className={ROW_CLASS}
    >
      {body}
    </Link>
  );
}
