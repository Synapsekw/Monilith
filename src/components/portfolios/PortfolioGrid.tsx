"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

import { cn } from "@/lib/utils";
import { HealthPill } from "./HealthPill";
import { ProgressBar } from "./ProgressBar";
import { PriorityPill } from "./PriorityPill";
import { AddBoardDialog } from "./AddBoardDialog";
import { EditPlacementPopover } from "./EditPlacementPopover";
import type { PortfolioRow, RowOwner } from "@/lib/portfolios/types";

type SortKey = "name" | "health" | "progress" | "priority";

const SORT_LABEL: Record<SortKey, string> = {
  name: "Board",
  health: "Health",
  progress: "Progress",
  priority: "Priority",
};

const HEALTH_RANK: Record<NonNullable<PortfolioRow["health"]>, number> = {
  off_track: 0,
  at_risk: 1,
  on_track: 2,
};

const PRIORITY_RANK: Record<NonNullable<PortfolioRow["priority"]>, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/**
 * In-page sort is client state over already-loaded rows: update the URL via the
 * History API so Next syncs it into `useSearchParams()` and this component
 * re-renders the re-sorted table WITHOUT re-running the server component
 * (0 new round-trips). A `<Link>`/`router.push` here would refetch the whole
 * page on every sort. See AGENTS.md §5 / gotcha-09.
 */
function setSort(key: SortKey) {
  const url = new URL(window.location.href);
  url.searchParams.set("sort", key);
  window.history.pushState(null, "", url);
}

export function PortfolioGrid({
  portfolioId,
  rows,
  members,
  addableBoards,
}: {
  portfolioId: string;
  rows: PortfolioRow[];
  members: RowOwner[];
  addableBoards: { id: string; name: string }[];
}) {
  const params = useSearchParams();
  const rawSort = params.get("sort");
  const sort: SortKey =
    rawSort === "health" || rawSort === "progress" || rawSort === "priority"
      ? rawSort
      : "name";

  const sorted = useMemo(() => {
    const r = rows.slice();
    r.sort((a, b) => {
      switch (sort) {
        case "progress":
          return (b.progressPct ?? -1) - (a.progressPct ?? -1);
        case "health": {
          const ra = a.health ? HEALTH_RANK[a.health] : 99;
          const rb = b.health ? HEALTH_RANK[b.health] : 99;
          return ra - rb || a.name.localeCompare(b.name);
        }
        case "priority": {
          const ra = a.priority ? PRIORITY_RANK[a.priority] : 99;
          const rb = b.priority ? PRIORITY_RANK[b.priority] : 99;
          return ra - rb || a.name.localeCompare(b.name);
        }
        default:
          return a.name.localeCompare(b.name);
      }
    });
    return r;
  }, [rows, sort]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-2">
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground text-xs">Sort by</span>
          <div className="flex gap-1">
            {(["name", "health", "progress", "priority"] as SortKey[]).map(
              (k) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={sort === k}
                  onClick={() => setSort(k)}
                  className={cn(
                    "focus-visible:ring-ring rounded px-2 py-1 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none",
                    sort === k
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:bg-state-hover/50 hover:text-foreground",
                  )}
                >
                  {SORT_LABEL[k]}
                </button>
              ),
            )}
          </div>
        </div>
        <AddBoardDialog portfolioId={portfolioId} boards={addableBoards} />
      </div>

      <div data-scroll-container className="min-h-0 flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="text-muted-foreground bg-card sticky top-0 z-10 text-left text-xs">
            <tr className="border-b">
              {[
                "Board",
                "Owner",
                "Health",
                "Progress",
                "Timeline",
                "Priority",
                "Status note",
                "Budget",
                "",
              ].map((h, i) => (
                <th
                  key={h || `actions-${i}`}
                  className="px-3 py-2 font-medium"
                  scope="col"
                >
                  {h ? h : <span className="sr-only">Actions</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr
                key={row.id}
                className="hover:bg-state-hover/30 border-t transition-colors"
              >
                <td className="px-3 py-2">
                  <Link
                    href={`/boards/${row.boardId}`}
                    className="font-medium hover:underline"
                  >
                    {row.name}
                  </Link>
                </td>
                <td className="text-muted-foreground px-3 py-2">
                  {row.owner?.fullName ?? "—"}
                </td>
                <td className="px-3 py-2">
                  <HealthPill
                    health={row.health}
                    isAuto={row.healthOverride === null}
                  />
                </td>
                <td className="px-3 py-2">
                  <ProgressBar pct={row.progressPct} />
                </td>
                <td className="text-muted-foreground px-3 py-2 text-xs tabular-nums">
                  {row.timelineStart && row.timelineEnd
                    ? `${row.timelineStart} → ${row.timelineEnd}`
                    : "—"}
                </td>
                <td className="px-3 py-2">
                  <PriorityPill priority={row.priority} />
                </td>
                <td className="text-muted-foreground max-w-48 truncate px-3 py-2 text-xs">
                  {row.statusNote ?? "—"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {row.budget === null
                    ? "—"
                    : row.budget.toLocaleString(undefined, {
                        maximumFractionDigits: 0,
                      })}
                </td>
                <td className="px-3 py-2 text-right">
                  <EditPlacementPopover
                    portfolioId={portfolioId}
                    row={row}
                    members={members}
                  />
                </td>
              </tr>
            ))}
            {sorted.length === 0 ? (
              <tr>
                <td
                  colSpan={9}
                  className="text-muted-foreground px-3 py-8 text-center text-sm"
                >
                  No boards yet. Add one to start tracking this portfolio.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
