"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { StatusPill } from "@/components/ui/status-pill";
import { getAgentRuns } from "@/lib/agents/actions";
import { timeAgo } from "@/lib/boards/automation-runs";
import {
  agentRunDisplayStatus,
  agentRunStatusColor,
  agentRunStatusLabel,
  describeAgentRun,
} from "@/lib/agents/run-status";

/**
 * Per-agent run history, collapsed by default.
 *
 * Mirrors `components/boards/automations/RecentRuns.tsx` — the shipped pattern
 * for exactly this problem — rather than inventing a second one. The load is
 * `enabled: open`, so an unexpanded roster costs ZERO extra round trips and run
 * history stays off first paint (working agreement #5); expanding is a data
 * fetch, never a navigation, so the roster/gallery/editor toggle around it is
 * untouched (gotcha-09).
 *
 * A failed read renders its own state. An agent that has never run and an agent
 * whose history won't load must not look the same — collapsing both into "No
 * runs yet" would recreate, in the UI, the exact silence this whole feature
 * exists to break.
 */
export function AgentRunHistory({
  agentId,
  agentName,
}: {
  agentId: string;
  agentName: string;
}) {
  const [open, setOpen] = useState(false);
  const { data: result, isLoading } = useQuery({
    queryKey: ["userAgentRuns", agentId],
    enabled: open,
    staleTime: 30_000,
    queryFn: () => getAgentRuns(agentId),
  });
  const runs = result?.ok ? result.data : [];
  const loadError = result != null && !result.ok;

  return (
    <div className="w-full">
      <button
        type="button"
        aria-expanded={open}
        // A roster renders one of these per row, so "Recent runs" alone is
        // ambiguous to a screen reader. The visible text is a prefix of the
        // accessible name, which is what WCAG 2.5.3 (Label in Name) asks for.
        aria-label={`Recent runs for ${agentName}`}
        onClick={() => setOpen((v) => !v)}
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring ease-keystone flex items-center gap-1 rounded-md text-xs transition-colors focus-visible:ring-2 focus-visible:outline-none"
      >
        <ChevronRight
          aria-hidden
          className={cn(
            "ease-keystone size-3 transition-transform",
            open && "rotate-90",
          )}
        />
        Recent runs
      </button>
      {open ? (
        <div className="mt-2 flex flex-col gap-1.5">
          {isLoading ? (
            <p className="text-muted-foreground text-xs">Loading…</p>
          ) : loadError ? (
            <p role="alert" className="text-destructive text-xs">
              Couldn&rsquo;t load this agent&rsquo;s runs. Try again.
            </p>
          ) : runs.length === 0 ? (
            <p className="text-muted-foreground text-xs">
              No runs yet. This agent runs once a day, at its scheduled hour.
            </p>
          ) : (
            runs.map((run) => {
              const status = agentRunDisplayStatus(run);
              return (
                <div
                  key={run.id}
                  className="flex items-start gap-2 text-xs sm:items-center"
                >
                  <StatusPill
                    color={agentRunStatusColor(status)}
                    variant="soft"
                    className="shrink-0"
                  >
                    {agentRunStatusLabel(status)}
                  </StatusPill>
                  <span className="text-muted-foreground shrink-0">
                    {timeAgo(run.createdAt)}
                  </span>
                  <span className="text-muted-foreground min-w-0 flex-1 truncate">
                    {describeAgentRun(run)}
                  </span>
                </div>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}
