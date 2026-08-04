"use client";

import { Users, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Kicker } from "@/components/ui/kicker";
import { EmptyState } from "@/components/ui/empty-state";
import type { BoardThreadRow } from "@/lib/ai/ask/board-threads";

/**
 * One thread. Matches the `/ask` rail's row idiom exactly — a transparent
 * hairline that BRIGHTENS on hover, and a brand-tinted fill when active — so a
 * thread looks the same wherever the user meets it.
 *
 * The select target and the share toggle are SIBLINGS inside the `<li>`, not
 * nested: a button inside a button is invalid HTML and the inner one is
 * unreachable by keyboard. Same structure the `/ask` rail uses for its row menu.
 */
function Row({
  thread,
  active,
  agentName,
  owned,
  busy,
  onSelect,
  onToggleShare,
}: {
  thread: BoardThreadRow;
  active: boolean;
  /** Display name of the agent behind this thread, when there is one. */
  agentName?: string;
  /** The caller owns this thread, so they may change who can see it. */
  owned: boolean;
  /** A visibility change is in flight for this thread. */
  busy?: boolean;
  onSelect: (id: string) => void;
  onToggleShare?: (thread: BoardThreadRow) => void;
}) {
  const shared = thread.visibility === "board";
  return (
    <li
      className={cn(
        "group/row hover:border-border-hover flex items-center rounded-md border border-transparent transition-colors",
        active && "bg-primary/10 border-primary/25",
      )}
    >
      <button
        type="button"
        aria-current={active ? "true" : undefined}
        title={
          owned
            ? undefined
            : "Shared with this board — only its owner can reply"
        }
        onClick={() => onSelect(thread.id)}
        className="focus-visible:ring-ring/50 min-w-0 flex-1 rounded-md px-2 py-1.5 text-left outline-none focus-visible:ring-3"
      >
        <span
          className={cn(
            "block truncate text-sm",
            active ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {thread.title}
        </span>
        {(agentName || shared) && (
          <span className="mt-1 flex min-w-0 items-center gap-1.5">
            {agentName && <Kicker className="truncate">{agentName}</Kicker>}
            {shared && (
              // Said in words, not by colour alone — and it means one thing
              // for both owners: everyone on this board can read it.
              <span className="text-kicker text-2xs shrink-0 rounded-sm border px-1 font-mono tracking-[0.12em] uppercase">
                Shared
              </span>
            )}
          </span>
        )}
      </button>

      {/* Owner-only. RLS scopes the update to the owner anyway, so this is the
          affordance, not the guard — but offering a control that always fails
          is worse than not offering it. */}
      {owned && onToggleShare && (
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={busy}
          aria-label={
            shared
              ? `Make "${thread.title}" private`
              : `Share "${thread.title}" with this board`
          }
          className="mr-1 shrink-0 opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100 pointer-coarse:opacity-100"
          onClick={() => onToggleShare(thread)}
        >
          {shared ? (
            <Users className="size-3.5" />
          ) : (
            <Lock className="size-3.5" />
          )}
        </Button>
      )}
    </li>
  );
}

function Group({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-0.5">
      <div className="px-2 pt-1 pb-1">
        <Kicker>{label}</Kicker>
      </div>
      <ul className="flex flex-col gap-0.5">{children}</ul>
    </section>
  );
}

/**
 * The dock's two thread groups: this board's threads (yours plus anything
 * shared to it) and your agents' own cross-board threads. Both are already
 * bounded server-side (50 / 5), so this renders the whole set.
 *
 * Two empty headings is not an empty state — when there is nothing at all, the
 * headings go away and the surface says what to do instead.
 */
export function DockThreadList({
  boardThreads,
  agentThreads,
  activeId,
  currentUserId,
  agentNames,
  sharingId,
  onSelect,
  onToggleShare,
}: {
  boardThreads: BoardThreadRow[];
  agentThreads: BoardThreadRow[];
  activeId: string | null;
  currentUserId: string;
  /** agent id → display name, for attributing a thread to the agent behind it. */
  agentNames: Record<string, string>;
  /** Thread whose visibility change is in flight. */
  sharingId?: string | null;
  onSelect: (id: string) => void;
  onToggleShare?: (thread: BoardThreadRow) => void;
}) {
  if (boardThreads.length === 0 && agentThreads.length === 0) {
    return (
      <EmptyState variant="inline" className="py-6">
        No threads yet. Ask something about this board to start one.
      </EmptyState>
    );
  }

  const rowFor = (t: BoardThreadRow) => (
    <Row
      key={t.id}
      thread={t}
      active={t.id === activeId}
      agentName={t.agent_id ? agentNames[t.agent_id] : undefined}
      owned={t.user_id === currentUserId}
      busy={sharingId === t.id}
      onSelect={onSelect}
      onToggleShare={onToggleShare}
    />
  );

  return (
    <div className="flex flex-col gap-2">
      {boardThreads.length > 0 && (
        <Group label="This board">{boardThreads.map(rowFor)}</Group>
      )}
      {agentThreads.length > 0 && (
        <Group label="From your agents">{agentThreads.map(rowFor)}</Group>
      )}
    </div>
  );
}
