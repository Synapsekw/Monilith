"use client";

import { useState } from "react";
import Link from "next/link";
import { StackedStatusBar } from "@/components/folders/charts/StackedStatusBar";
import { HEALTH } from "@/components/folders/tabs/Boards";
import { STATUS_BG, StatusPill } from "@/components/ui/status-pill";
import type { BoardSummary } from "@/lib/folders/rollup";
import { cn } from "@/lib/utils";
import { Failed, Panel } from "./Panel";

type Sort = "health" | "size" | "name";
const SORTS: { key: Sort; label: string }[] = [
  { key: "health", label: "Health" },
  { key: "size", label: "Size" },
  { key: "name", label: "A–Z" },
];

const LEGEND = [
  { label: "Done", bg: STATUS_BG.green },
  { label: "In progress", bg: STATUS_BG.blue },
  { label: "Overdue", bg: STATUS_BG.red },
  { label: "Not started", bg: STATUS_BG.gray },
];

/** Worst first by default: health, then overdue, then name. */
export function sortBoardStatus(
  boards: BoardSummary[],
  by: Sort,
): BoardSummary[] {
  const byName = (a: BoardSummary, b: BoardSummary) =>
    a.name.localeCompare(b.name);
  return [...boards].sort((a, b) =>
    by === "name"
      ? byName(a, b)
      : by === "size"
        ? b.total - a.total || byName(a, b)
        : HEALTH[a.health].rank - HEALTH[b.health].rank ||
          b.overdue - a.overdue ||
          byName(a, b),
  );
}

export function BoardStatusPanel({
  kicker,
  title = "Status by board",
  boards,
  failed,
  onRetry,
}: {
  kicker: string;
  title?: string;
  boards: BoardSummary[];
  failed: boolean;
  onRetry: () => void;
}) {
  const [sort, setSort] = useState<Sort>("health");
  return (
    <Panel kicker={kicker} title={title}>
      {failed ? (
        <Failed onRetry={onRetry} />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <ul className="text-muted-foreground flex flex-wrap gap-3 text-xs">
              {LEGEND.map((l) => (
                <li key={l.label} className="inline-flex items-center gap-1.5">
                  <span className={cn("size-2 rounded-sm", l.bg)} />
                  {l.label}
                </li>
              ))}
            </ul>
            {boards.length > 1 ? (
              <div
                role="group"
                aria-label="Sort boards"
                data-print-hide
                className="flex gap-1"
              >
                {SORTS.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    aria-pressed={sort === s.key}
                    onClick={() => setSort(s.key)}
                    className={cn(
                      "focus-visible:ring-ring inline-flex items-center rounded-sm border px-2 py-0.5 text-xs outline-none focus-visible:ring-2 pointer-coarse:min-h-11 pointer-coarse:px-3",
                      sort === s.key
                        ? "border-border-bright text-foreground"
                        : "text-muted-foreground hover:border-border-hover",
                    )}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          {sortBoardStatus(boards, sort).map((b) => (
            <div key={b.id} className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2 text-xs">
                <Link
                  href={`/boards/${b.id}`}
                  className="hover:text-foreground text-muted-foreground min-w-0 truncate font-medium"
                >
                  {b.name}
                </Link>
                <span className="flex shrink-0 items-center gap-2">
                  <StatusPill color={HEALTH[b.health].color} variant="soft">
                    {HEALTH[b.health].label}
                  </StatusPill>
                  <span className="text-muted-foreground font-mono tabular-nums">
                    {b.total}
                  </span>
                </span>
              </div>
              <StackedStatusBar
                mix={{
                  done: b.done,
                  inProgress: b.inProgress,
                  overdue: b.overdue,
                  notStarted: b.notStarted,
                }}
                label={b.name}
              />
            </div>
          ))}
        </>
      )}
    </Panel>
  );
}
