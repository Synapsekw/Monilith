"use client";

import { Switch } from "@/components/ui/switch";
import { Kicker } from "@/components/ui/kicker";
import { StatusPill } from "@/components/ui/status-pill";
import { EmptyState } from "@/components/ui/empty-state";
import { AgentRunHistory } from "@/components/agents/AgentRunHistory";
import {
  agentRunDisplayStatus,
  agentRunStatusColor,
  agentRunStatusLabel,
  type AgentRunLike,
} from "@/lib/agents/run-status";
import type { AgentCadence } from "@/lib/agents/agent-config";

export type RosterAgent = {
  id: string;
  name: string;
  templateId: string;
  /** Carried, not yet rendered: the roster shows only the hour today. Typed as
   *  the full `AgentCadence` union rather than the `"daily"` literal so a
   *  weekly or monthly agent can reach this component at all — labelling the
   *  cadence in the row is a UI change of its own. */
  cadence: AgentCadence;
  runAtLocalHour: number;
  enabled: boolean;
  /** The agent's most recent run, or null if it has never run. Carries the raw
   *  row rather than a status string because a claimed-but-unfinalised run is
   *  stored as `error` and only `run-status.ts` — reading the sentinel and the
   *  timestamp together — can tell that apart from a real failure. */
  lastRun: AgentRunLike | null;
  /** Undecided proposals waiting on this agent's owner. Comes from ONE tally
   *  over the whole roster (`countPendingProposalsByAgent`), never a query per
   *  row. Optional so a surface with no tally in hand simply shows no badge. */
  pendingProposals?: number;
};

function hourLabel(h: number): string {
  return `${String(h).padStart(2, "0")}:00`;
}

/** The person's agent list. Toggling is the only mutation here; editing opens
 *  the editor. Hairlines brighten on hover — never thicken (Keystone).
 *
 *  Each row carries a last-run pill (from the roster's own first-paint read)
 *  and an expandable history that fetches only when opened. The pill is the
 *  point of the surface: until it existed, an agent that had been failing every
 *  morning for a week looked exactly like one that was working. */
export function AgentRoster({
  agents,
  onToggle,
  onEdit,
}: {
  agents: RosterAgent[];
  onToggle: (id: string, enabled: boolean) => void;
  onEdit?: (id: string) => void;
}) {
  if (agents.length === 0) {
    // NOTE: EmptyState takes `children` — it has no title/description props.
    return (
      <EmptyState>
        No agents yet. Start from a template below — you can edit everything
        afterwards.
      </EmptyState>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {agents.map((a) => {
        const status = a.lastRun ? agentRunDisplayStatus(a.lastRun) : null;
        return (
          <li
            key={a.id}
            className="bg-surface hover:border-border-hover ease-keystone flex flex-col gap-3 rounded-lg border p-4 transition-colors"
          >
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={onEdit ? () => onEdit(a.id) : undefined}
                disabled={!onEdit}
                className="focus-visible:ring-ring min-w-0 flex-1 rounded-md text-left focus-visible:ring-2 focus-visible:outline-none disabled:cursor-default"
              >
                <Kicker>{a.templateId.replace(/-/g, " ")}</Kicker>
                <p className="truncate text-sm font-semibold">{a.name}</p>
                <p className="text-muted-foreground text-xs">
                  Daily at {hourLabel(a.runAtLocalHour)}
                </p>
              </button>
              <div className="flex shrink-0 items-center gap-3">
                {/* The ONLY way a queued approval is discoverable without
                    opening the run that produced it. Colour is never the sole
                    signal — the count carries the word with it (WCAG AA). */}
                {a.pendingProposals && a.pendingProposals > 0 ? (
                  <StatusPill color="yellow" variant="soft">
                    {a.pendingProposals} awaiting approval
                  </StatusPill>
                ) : null}
                {status ? (
                  <StatusPill
                    color={agentRunStatusColor(status)}
                    variant="soft"
                  >
                    {agentRunStatusLabel(status)}
                  </StatusPill>
                ) : null}
                <Switch
                  checked={a.enabled}
                  aria-label={`Enable ${a.name}`}
                  onCheckedChange={(v) => onToggle(a.id, v)}
                />
              </div>
            </div>
            <AgentRunHistory agentId={a.id} agentName={a.name} />
          </li>
        );
      })}
    </ul>
  );
}
