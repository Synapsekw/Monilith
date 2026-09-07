"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { StatusPill } from "@/components/ui/status-pill";
import { getAgentRuns, getChildRuns } from "@/lib/agents/actions";
import { getPendingProposals } from "@/lib/agents/proposal-actions";
import type { PendingProposal } from "@/lib/agents/proposal-display";
import { ProposalCard } from "@/components/agents/ProposalCard";
import { Kicker } from "@/components/ui/kicker";
import { timeAgo } from "@/lib/boards/automation-runs";
import {
  agentRunDisplayStatus,
  agentRunStatusColor,
  agentRunStatusLabel,
  describeAgentRun,
  MODEL_SUBSTITUTED_NOTE,
  memoryDroppedNote,
  subtreeTokens,
  agentRunTriggerLabel,
  type AgentRunSummary,
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
  const {
    data: result,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["userAgentRuns", agentId],
    enabled: open,
    staleTime: 30_000,
    queryFn: () => getAgentRuns(agentId),
  });
  const runs = result?.ok ? result.data : [];
  // TWO ways this read fails, and both have to land on the error branch.
  //
  // `isError` is the one that was missing: when the action call itself THROWS
  // (a network drop mid-Server-Action, a deploy swapping the action id under an
  // open tab), `result` is `undefined` and `isLoading` is already false — so
  // reading only `!result.ok` fell through to `runs.length === 0` and rendered
  // "No runs yet." That is the exact conflation the docstring above forbids: a
  // broken agent looking identical to one that has never run.
  const failed = result ?? null;
  const loadError = isError || (failed !== null && !failed.ok);
  // The server's own message, not a hardcoded restatement of it. `getAgentRuns`
  // distinguishes "that agent doesn't exist" from "couldn't load the runs", and
  // throwing that distinction away at the last hop leaves the user with the
  // vaguer of the two. A thrown call has no message of its own, so it keeps the
  // generic one.
  const loadErrorMessage =
    failed !== null && !failed.ok
      ? failed.error
      : "Couldn’t load this agent’s runs. Try again.";

  /**
   * The undecided proposals for the runs just listed — ONE indexed read for the
   * whole page of runs, never one per row (working agreement #5; the query is
   * `run_id IN (…)` over the leading column of
   * `user_agent_proposals_call_uniq`).
   *
   * It runs only after the runs land, and only when there are runs to ask
   * about, so an unexpanded roster still costs zero round trips. A failure is
   * silent BY DESIGN: run history is the signal this surface exists for, and a
   * proposal read that fails must not replace it with an error.
   */
  const queryClient = useQueryClient();
  const runIds = runs.map((r) => r.id);
  const { data: proposalResult } = useQuery({
    queryKey: ["userAgentProposals", agentId, runIds],
    enabled: open && runIds.length > 0,
    staleTime: 30_000,
    queryFn: () => getPendingProposals(runIds),
  });
  const proposalsByRun = new Map<string, PendingProposal[]>();
  for (const p of proposalResult?.ok ? proposalResult.data : []) {
    proposalsByRun.set(p.runId, [...(proposalsByRun.get(p.runId) ?? []), p]);
  }

  /**
   * The runs these runs delegated — ONE batched read for the whole page, beside
   * the proposals query and on the same terms.
   *
   * THE DATA-FETCHING BUDGET (working agreement #5), stated: children ship with
   * the page of runs, once, when the disclosure opens. Reading what a run
   * delegated therefore costs ZERO further round trips — there is no per-run
   * expander to click and nothing to fetch when one is read, and the 30s
   * staleTime means collapsing and re-expanding is free too. The read itself is
   * bounded and indexed: `parent_run_id IN (…)` over
   * `user_agent_runs_parent_idx`, capped at three children per parent by
   * `DELEGATE_FANOUT_MAX`, over an id list the action caps at the page size.
   *
   * A failure is silent, exactly like the proposals read: run history is the
   * signal this surface exists for, and a side read must never replace it with
   * an error.
   */
  const { data: childResult } = useQuery({
    queryKey: ["userAgentChildRuns", agentId, runIds],
    enabled: open && runIds.length > 0,
    staleTime: 30_000,
    queryFn: () => getChildRuns(runIds),
  });
  const childrenByRun = new Map<string, AgentRunSummary[]>();
  for (const c of childResult?.ok ? childResult.data : []) {
    if (!c.parentRunId) continue;
    childrenByRun.set(c.parentRunId, [
      ...(childrenByRun.get(c.parentRunId) ?? []),
      c,
    ]);
  }

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
              {loadErrorMessage}
            </p>
          ) : runs.length === 0 ? (
            <p className="text-muted-foreground text-xs">
              No runs yet. This agent runs once a day, at its scheduled hour.
            </p>
          ) : (
            runs.map((run) => {
              const status = agentRunDisplayStatus(run);
              const proposals = proposalsByRun.get(run.id) ?? [];
              const children = childrenByRun.get(run.id) ?? [];
              // Null for the scheduled runs that are almost every row — see
              // `agentRunTriggerLabel`. Answers "why does this run exist?",
              // which the status pill does not.
              const triggerLabel = agentRunTriggerLabel(run.trigger);
              return (
                <div key={run.id} className="flex flex-col gap-1">
                  <div className="flex items-start gap-2 text-xs sm:items-center">
                    <StatusPill
                      color={agentRunStatusColor(status)}
                      variant="soft"
                      className="shrink-0"
                    >
                      {agentRunStatusLabel(status)}
                    </StatusPill>
                    {triggerLabel ? (
                      <Kicker className="shrink-0">{triggerLabel}</Kicker>
                    ) : null}
                    <span className="text-muted-foreground shrink-0">
                      {timeAgo(run.createdAt)}
                    </span>
                    <span className="text-muted-foreground min-w-0 flex-1 truncate">
                      {describeAgentRun(run)}
                    </span>
                    {/* The real cost of a delegating run. A child bills its own
                        ai_usage row, so this run's own token columns describe
                        only itself — and it is deliberately tokens, not money:
                        ai_usage is admin-only by RLS. Rendered ONLY when this
                        run actually delegated, so an ordinary run's line is
                        byte-for-byte what it was before this feature. */}
                    {children.length > 0 ? (
                      <span className="text-kicker text-2xs shrink-0 font-mono tabular-nums">
                        {subtreeTokens(run, children).toLocaleString()} tokens
                        across {children.length + 1} runs
                      </span>
                    ) : null}
                  </div>
                  {/* The runs this one delegated, indented under it. A child is
                      a run of a DIFFERENT agent, so its name leads — without it
                      the row reads as an anonymous second run of this agent.
                      Nothing renders when a run delegated to nobody: no empty
                      expander, no "0 children". */}
                  {children.length > 0 ? (
                    <div
                      role="group"
                      aria-label={`Runs ${agentName} delegated`}
                      className="ml-4 flex flex-col gap-1 border-l pl-3"
                    >
                      {children.map((c) => {
                        const childStatus = agentRunDisplayStatus(c);
                        return (
                          <div
                            key={c.id}
                            className="flex items-start gap-2 text-xs sm:items-center"
                          >
                            <StatusPill
                              color={agentRunStatusColor(childStatus)}
                              variant="soft"
                              className="shrink-0"
                            >
                              {agentRunStatusLabel(childStatus)}
                            </StatusPill>
                            <span className="text-foreground shrink-0 font-medium">
                              {c.agentName ?? "Another agent"}
                            </span>
                            <span className="text-muted-foreground min-w-0 flex-1 truncate">
                              {describeAgentRun(c)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                  {/* Its own line, and a needs-attention pill rather than a
                      failure one: the briefing WAS sent, but on a model the
                      owner did not choose. Pairing the colour with words keeps
                      it readable without relying on hue (WCAG AA). */}
                  {run.modelSubstituted ? (
                    <div className="flex items-center gap-2 text-xs">
                      <StatusPill
                        color="yellow"
                        variant="soft"
                        className="shrink-0"
                      >
                        Substituted
                      </StatusPill>
                      <span className="text-muted-foreground min-w-0 flex-1 truncate">
                        {MODEL_SUBSTITUTED_NOTE}
                      </span>
                    </div>
                  ) : null}
                  {/* Its own line, same rationale as modelSubstituted above: the
                      briefing WAS sent, just without documents that did not
                      fit — not a failure, so no destructive-looking pill. */}
                  {run.documentsOmitted && (
                    <span className="text-muted-foreground text-xs">
                      Reference documents omitted — the model&rsquo;s context
                      was too small.
                    </span>
                  )}
                  {/* Same shape again, and deliberately NOT a failure pill:
                      memory truncation is partial by design, so the run
                      succeeded on the freshest notes that fit. The count is
                      what makes it actionable. */}
                  {run.memoryNotesDropped > 0 && (
                    <span className="text-muted-foreground text-xs">
                      {memoryDroppedNote(run.memoryNotesDropped)}.
                    </span>
                  )}
                  {/* What this run asked permission for. Rendered under the run
                      that produced it: the proposal only makes sense next to
                      the report that explains why the agent wanted it. */}
                  {proposals.length > 0 ? (
                    <div className="mt-1 flex flex-col gap-1.5">
                      {proposals.map((p) => (
                        <ProposalCard
                          key={p.id}
                          proposal={p}
                          // Without this the cached list still says `pending`:
                          // collapsing and re-expanding inside the 30s
                          // staleTime remounts the card from cache with fresh
                          // buttons on a row that is already decided.
                          // `revalidatePath` refreshes the roster badge on the
                          // server; it cannot touch this client cache.
                          onDecided={() =>
                            void queryClient.invalidateQueries({
                              queryKey: ["userAgentProposals", agentId],
                            })
                          }
                        />
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}
