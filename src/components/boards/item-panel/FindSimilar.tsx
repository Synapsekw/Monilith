"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Sparkles } from "lucide-react";
import {
  findSimilarItems,
  type FindSimilarResult,
} from "@/lib/ai/embeddings/search";
import { Button } from "@/components/ui/button";
import { Kicker } from "@/components/ui/kicker";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * "Find similar" item-panel section (F15). Semantic neighbours of the current
 * item, ranked by the stored-vector `match_items` path. Purely client-state:
 * the section mounts inert and a server round-trip happens ONLY on the explicit
 * "Find similar" click (spec §6 perf budget — no fetch on open, no fetch on any
 * toggle). Each hit deep-links to its item; those are genuine navigations, not
 * in-page toggles. When the item isn't embedded yet (queued, not swept) the
 * action returns `not_indexed`, surfaced as a graceful "indexing…" state.
 */
export function FindSimilar({ itemId }: { itemId: string }) {
  const [result, setResult] = useState<FindSimilarResult | null>(null);
  const [hasRun, setHasRun] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  async function run() {
    setHasRun(true);
    setIsLoading(true);
    try {
      setResult(await findSimilarItems(itemId));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <section className="space-y-3 border-t pt-4">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-1">
          <Kicker index="AI">Find similar</Kicker>
          <p className="text-muted-foreground text-xs">
            Items that mean the same thing, not just matching words.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={run}
          disabled={isLoading}
          className="shrink-0"
        >
          <Sparkles className="size-3.5" aria-hidden />
          {hasRun ? "Refresh" : "Find similar"}
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2" aria-busy="true">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-2/3" />
        </div>
      ) : !hasRun || !result ? null : result.status === "not_indexed" ? (
        <EmptyState variant="inline">
          This item is still being indexed. Check back in a moment.
        </EmptyState>
      ) : result.items.length === 0 ? (
        <EmptyState variant="inline">No similar items found.</EmptyState>
      ) : (
        <ul className="space-y-1.5">
          {result.items.map((item) => (
            <li key={item.id}>
              <Link
                href={`/boards/${item.boardId}?item=${item.id}`}
                className="group border-border hover:border-border-hover bg-surface hover:bg-surface-muted ease-keystone flex items-center gap-3 rounded-lg border px-3 py-2 transition-colors"
              >
                <span className="min-w-0 flex-1">
                  <span className="text-foreground block truncate text-sm font-medium">
                    {item.name}
                  </span>
                  <span className="text-kicker block truncate text-xs">
                    {item.boardName}
                  </span>
                </span>
                <ArrowUpRight
                  className="text-muted-foreground group-hover:text-foreground size-4 shrink-0 transition-colors"
                  aria-hidden
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
