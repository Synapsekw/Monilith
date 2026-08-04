"use client";

import { cn } from "@/lib/utils";
import { Kicker } from "@/components/ui/kicker";
import { EmptyState } from "@/components/ui/empty-state";
import type { BoardThreadRow } from "@/lib/ai/ask/board-threads";

/**
 * One thread. Matches the `/ask` rail's row idiom exactly — a transparent
 * hairline that BRIGHTENS on hover, and a brand-tinted fill when active — so a
 * thread looks the same wherever the user meets it.
 */
function Row({
  thread,
  active,
  agentName,
  shared,
  onSelect,
}: {
  thread: BoardThreadRow;
  active: boolean;
  /** Display name of the agent behind this thread, when there is one. */
  agentName?: string;
  /** Someone else put this thread on the board. Readable, not repliable. */
  shared?: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <li>
      <button
        type="button"
        aria-current={active ? "true" : undefined}
        onClick={() => onSelect(thread.id)}
        className={cn(
          "hover:border-border-hover focus-visible:border-ring focus-visible:ring-ring/50 w-full rounded-md border border-transparent px-2 py-1.5 text-left transition-colors outline-none focus-visible:ring-3",
          active && "bg-primary/10 border-primary/25",
        )}
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
              // Said in words, not by colour alone: the composer will refuse a
              // turn on this thread and the user deserves to know before they
              // type into it.
              <span
                title="Shared with this board — only its owner can reply"
                className="text-kicker text-2xs shrink-0 rounded-sm border px-1 font-mono tracking-[0.12em] uppercase"
              >
                Shared
              </span>
            )}
          </span>
        )}
      </button>
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
  onSelect,
}: {
  boardThreads: BoardThreadRow[];
  agentThreads: BoardThreadRow[];
  activeId: string | null;
  currentUserId: string;
  /** agent id → display name, for attributing a thread to the agent behind it. */
  agentNames: Record<string, string>;
  onSelect: (id: string) => void;
}) {
  if (boardThreads.length === 0 && agentThreads.length === 0) {
    return (
      <EmptyState variant="inline" className="py-6">
        No threads yet. Ask something about this board to start one.
      </EmptyState>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {boardThreads.length > 0 && (
        <Group label="This board">
          {boardThreads.map((t) => (
            <Row
              key={t.id}
              thread={t}
              active={t.id === activeId}
              agentName={t.agent_id ? agentNames[t.agent_id] : undefined}
              shared={t.user_id !== currentUserId}
              onSelect={onSelect}
            />
          ))}
        </Group>
      )}
      {agentThreads.length > 0 && (
        <Group label="From your agents">
          {agentThreads.map((t) => (
            <Row
              key={t.id}
              thread={t}
              active={t.id === activeId}
              agentName={t.agent_id ? agentNames[t.agent_id] : undefined}
              onSelect={onSelect}
            />
          ))}
        </Group>
      )}
    </div>
  );
}
