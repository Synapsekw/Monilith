"use client";

import { Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type {
  AgentMentionTarget,
  MentionTarget,
} from "@/lib/collaboration/mentions";

/** The name shown, and offered in the menu, for "nobody in particular". There
 *  is no handle for this choice on purpose — "monolith" and "none" are
 *  reserved handles (see `agents/handle.ts` · RESERVED_HANDLES) precisely so
 *  they can never collide with a real agent's. */
const PLAIN_ASSISTANT = "Monolith assistant";

function isAgent(t: MentionTarget): t is AgentMentionTarget {
  return t.kind === "agent";
}

/**
 * Thread header: the thread's title on the left, and on the right a chip
 * naming who is answering — with a dropdown to switch to another of the
 * owner's agents, or hand the thread back to the plain Monolith assistant
 * (`agentId: null`).
 *
 * Dumb by design: it reports the choice via `onAgentChange` and holds no
 * state of its own. Switching a thread's persona is exactly ONE Server Action
 * (`setConversationAgent`), owned and dispatched by the caller (`AskChat`) —
 * this component never navigates (`<Link>` / `router`) and never triggers a
 * `router.refresh()` (working agreement #5).
 */
export function ThreadHeader({
  title,
  agents,
  agentId,
  onAgentChange,
}: {
  title: string;
  /** The owner's agents. Non-agent mention targets (people) are filtered out
   *  — this switcher only ever offers agents plus the plain assistant. */
  agents: readonly MentionTarget[];
  /** Who is currently on duty, or null for the plain assistant. */
  agentId: string | null;
  onAgentChange: (agentId: string | null) => void;
}) {
  const roster = agents.filter(isAgent);
  const current = roster.find((a) => a.agentId === agentId);
  const currentName = current?.name ?? PLAIN_ASSISTANT;

  return (
    <div className="flex items-center justify-between gap-3 border-b px-4 py-2">
      <h2 className="min-w-0 truncate text-sm font-semibold" title={title}>
        {title}
      </h2>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="shrink-0 gap-1.5"
          >
            <span
              aria-hidden="true"
              className="bg-primary size-1.5 shrink-0 rounded-full"
            />
            <span className="max-w-40 truncate">{currentName}</span>
            <ChevronDown className="text-muted-foreground size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {roster.map((a) => (
            <DropdownMenuItem
              key={a.agentId}
              onSelect={() => onAgentChange(a.agentId)}
            >
              <span className="min-w-0 flex-1 truncate">{a.name}</span>
              {a.agentId === agentId ? (
                <Check className="text-muted-foreground size-3.5" />
              ) : null}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => onAgentChange(null)}>
            <span className="min-w-0 flex-1 truncate">{PLAIN_ASSISTANT}</span>
            {agentId === null ? (
              <Check className="text-muted-foreground size-3.5" />
            ) : null}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
