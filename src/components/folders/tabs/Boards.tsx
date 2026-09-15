"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { renameGroup } from "@/lib/boards/actions/group";
import { showMutationError } from "@/lib/ui/mutation-toast";
import { Button } from "@/components/ui/button";
import { Kicker } from "@/components/ui/kicker";
import { StatusPill, type StatusPillColor } from "@/components/ui/status-pill";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { StackedStatusBar } from "@/components/folders/charts/StackedStatusBar";
import {
  boardSummaries,
  onlyOnOneBoard,
  type BoardHealth,
} from "@/lib/folders/rollup";
import type { StageSummary } from "@/lib/folders/stages";
import type { FolderBoardRef, RollupRow } from "@/lib/folders/types";

export type BoardSort = "health" | "size" | "name";
const HEALTH: Record<
  BoardHealth,
  { label: string; color: StatusPillColor; rank: number }
> = {
  off_track: { label: "Off track", color: "red", rank: 0 },
  at_risk: { label: "At risk", color: "yellow", rank: 1 },
  on_track: { label: "On track", color: "green", rank: 2 },
};

/**
 * Sorting is client state — 0 round-trips.
 */
export function BoardsTab({
  rows,
  boards,
  stages,
}: {
  rows: RollupRow[];
  boards: FolderBoardRef[];
  stages: StageSummary[];
}) {
  const router = useRouter();
  const [sort, setSort] = useState<BoardSort>("name");
  const [, startTransition] = useTransition();
  const summaries = useMemo(
    () => boardSummaries(rows, boards, stages),
    [rows, boards, stages],
  );
  const sorted = useMemo(() => {
    const s = [...summaries];
    if (sort === "health")
      s.sort(
        (a, b) =>
          HEALTH[a.health].rank - HEALTH[b.health].rank ||
          a.name.localeCompare(b.name),
      );
    else if (sort === "size")
      s.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
    else s.sort((a, b) => a.name.localeCompare(b.name));
    return s;
  }, [summaries, sort]);
  const singles = onlyOnOneBoard(rows, stages);
  const mergeTargets = stages.filter((s) => s.onlyOnBoard === null);

  function merge(groupId: string, targetName: string) {
    startTransition(async () => {
      const res = await renameGroup({ groupId, name: targetName });
      if (!res.ok) {
        showMutationError("Couldn't merge the stage.", new Error(res.error));
        return;
      }
      router.refresh(); // server data changed — a real refetch is correct here
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2" data-print-hide>
        <Kicker>Sort</Kicker>
        {(["health", "size", "name"] as const).map((k) => (
          <Button
            key={k}
            type="button"
            size="sm"
            variant={sort === k ? "default" : "outline"}
            aria-label={`Sort by ${k}`}
            onClick={() => setSort(k)}
          >
            {k === "health" ? "Health" : k === "size" ? "Size" : "A–Z"}
          </Button>
        ))}
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-xs">
          <thead className="text-muted-foreground border-b text-left">
            <tr>
              <th className="px-3 py-2 font-medium">Board</th>
              <th className="px-3 py-2 font-medium">Health</th>
              <th className="px-3 py-2 font-medium">Status mix</th>
              <th className="px-3 py-2 text-right font-medium">Items</th>
              <th className="px-3 py-2 text-right font-medium">Done</th>
              <th className="px-3 py-2 text-right font-medium">Overdue</th>
              <th className="px-3 py-2 text-right font-medium">Stale</th>
              <th className="px-3 py-2 font-medium">Next milestone</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((b) => (
              <tr
                key={b.id}
                className="hover:bg-state-hover border-b last:border-b-0"
              >
                <td className="px-3 py-2 font-medium">
                  <Link data-testid="board-name" href={`/boards/${b.id}`}>
                    {b.name}
                  </Link>
                </td>
                <td className="px-3 py-2">
                  <StatusPill color={HEALTH[b.health].color} variant="soft">
                    {HEALTH[b.health].label}
                  </StatusPill>
                </td>
                <td className="w-48 px-3 py-2">
                  <StackedStatusBar
                    mix={{
                      done: b.done,
                      inProgress: b.inProgress,
                      overdue: b.overdue,
                      notStarted: b.notStarted,
                    }}
                    label={b.name}
                  />
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">
                  {b.total}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">
                  {b.donePct === null ? "—" : `${b.donePct}%`}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">
                  {b.overdue}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">
                  {b.stale}
                </td>
                <td className="text-muted-foreground px-3 py-2 font-mono">
                  {b.nextMilestone ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {singles.length > 0 ? (
        <section className="flex flex-col gap-2">
          <div>
            <Kicker>02</Kicker>
            <h2 className="text-sm font-semibold">Stages on only one board</h2>
          </div>
          <ul className="flex flex-col gap-1">
            {singles.map((g) => (
              <li
                key={g.groupId}
                className="flex items-center justify-between text-xs"
              >
                <span>
                  <span className="font-medium">{g.groupName}</span>{" "}
                  <span className="text-muted-foreground">· {g.boardName}</span>
                </span>
                {mergeTargets.length > 0 ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        aria-label={`Merge ${g.groupName} into a stage`}
                      >
                        Merge into stage…
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {mergeTargets.map((t) => (
                        <DropdownMenuItem
                          key={t.key}
                          onSelect={() => merge(g.groupId, t.name)}
                        >
                          {t.name}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
