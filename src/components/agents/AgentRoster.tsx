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
  /** The typeable address (`@handle`). Rendered because it is the ONLY thing
   *  a person can type to summon this agent, and it is not the display name —
   *  without it the roster cannot answer "what do I type?". */
  handle: string;
  templateId: string;
  /** Which schedule the row describes. Every member of the union renders a
   *  DIFFERENT line — see `scheduleLabel` — so a weekly agent is never
   *  described as daily and a manual one is never given a schedule at all. */
  cadence: AgentCadence;
  runAtLocalHour: number;
  /** The cadence's day operand, and only ever the one its cadence names
   *  (`user_agents_cadence_fields`). 0-6 is Sunday-Saturday. */
  runOnWeekday: number | null;
  runOnDayOfMonth: number | null;
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

/** 0-6, Sunday-first — matches `run_on_weekday` (Postgres `extract(dow …)`),
 *  so the index IS the value, with no translation. */
const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/**
 * The row's one-line schedule. Exhaustive over `AgentCadence` on purpose:
 * adding a cadence without deciding how the roster describes it becomes a
 * compile error rather than a row that quietly says the wrong thing.
 *
 * This replaced a hardcoded "Daily at HH:00" that every row rendered
 * regardless of cadence — so a weekly agent claimed to run every morning, and
 * a manual one advertised a fire slot it does not occupy at all.
 */
function scheduleLabel(agent: RosterAgent): string {
  const at = hourLabel(agent.runAtLocalHour);
  switch (agent.cadence) {
    case "daily":
      return `Daily at ${at}`;
    case "weekdays":
      return `Weekdays at ${at}`;
    case "weekly":
      // Null only if the row broke `user_agents_cadence_fields`; naming no day
      // beats naming Sunday by accident.
      return agent.runOnWeekday === null
        ? `Weekly at ${at}`
        : `${WEEKDAYS[agent.runOnWeekday]}s at ${at}`;
    case "monthly":
      return agent.runOnDayOfMonth === null
        ? `Monthly at ${at}`
        : `Day ${agent.runOnDayOfMonth} at ${at}`;
    // No fire slot at all: it runs when it is addressed by `@handle`, or when
    // another agent delegates to it. Naming an hour here would be fiction.
    case "manual":
      return "Only when you ask";
  }
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
                <span className="flex items-center gap-2">
                  <Kicker>{a.templateId.replace(/-/g, " ")}</Kicker>
                  {/* Deliberately NOT uppercased, unlike every other kicker:
                      a handle is lowercase-only and this is the literal string
                      the owner has to type. Rendering "@MORNING-BRIEF" would
                      be an instruction that does not work. */}
                  <Kicker className="normal-case">@{a.handle}</Kicker>
                </span>
                <p className="truncate text-sm font-semibold">{a.name}</p>
                <p className="text-muted-foreground text-xs">
                  {scheduleLabel(a)}
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
