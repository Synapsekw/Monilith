"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
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

const REASONS = ["overdue", "blocked", "unassigned", "stale"] as const;

/** Tells the reader the list under a board is a sample. The group's counts per
 *  reason overlap, so there is no distinct total: the notice names the reason
 *  with the largest cut-off count and counts the shown items of that reason. */
function CutNotice({ g }: { g: AttentionGroup }) {
  const cut = REASONS.map((reason) => ({
    reason,
    total: g[reason],
    shown: g.items.filter((a) => a.reason === reason).length,
  }))
    .filter((c) => c.shown < c.total)
    .sort((a, b) => b.total - a.total)[0];
  if (!cut) return null;
  return (
    <p
      data-testid="attention-cut"
      className="text-muted-foreground py-2 text-xs"
    >
      Showing {cut.shown} of {cut.total} {cut.reason}.{" "}
      <Link
        href={`/boards/${g.boardId}`}
        className="hover:text-foreground underline"
      >
        Open the board for all.
      </Link>
    </p>
  );
}

function Group({ g }: { g: AttentionGroup }) {
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
          g.items.length === 0 ? (
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
 */
export function AttentionPanel({
  kicker,
  title = "Needs attention",
  attention,
  caption,
  groups,
  onRetry,
}: {
  kicker: string;
  title?: string;
  attention: AttentionRow[] | null;
  caption: string | null;
  groups?: AttentionGroup[] | null;
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
              <Group key={g.boardId} g={g} />
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
