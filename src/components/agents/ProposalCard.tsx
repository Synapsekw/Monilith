"use client";

import { useState, useTransition } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kicker } from "@/components/ui/kicker";
import { StatusPill } from "@/components/ui/status-pill";
import {
  PROPOSAL_STATE_PILL,
  RELOAD_FOR_OUTCOME,
  isRetryableDecisionError,
  proposalDisplayState,
  proposalExpiryLabel,
  proposalTargetLabel,
  type PendingProposal,
} from "@/lib/agents/proposal-display";
import { decideProposal } from "@/lib/agents/proposal-actions";
import { useRestoreFocusAfterPending } from "@/lib/hooks/use-restore-focus-after-pending";

/**
 * One action an agent asked permission for, and the owner's decision on it.
 *
 * Modelled on `components/ai/actions/ActionConfirmCard` — same kicker / summary
 * / approve-decline shape, deliberately, so "something wants your approval"
 * looks the same wherever it appears. The differences are all consequences of
 * this card being driven by a PERSISTED row rather than a live turn:
 *
 *   - the summary is read from the row, and the row's summary is SERVER-derived
 *     from the validated tool input (`proposal-summary.ts`). Model prose is
 *     never the thing being approved;
 *   - the decision is a Server Action taking only the row id, so the payload
 *     that executes is re-read and re-validated server-side and can never be
 *     round-tripped through the browser;
 *   - the row can already be terminal (approved / rejected / failed) or expired,
 *     and those render as a state, not an affordance.
 */

export function ProposalCard({
  proposal,
  onDecided,
}: {
  proposal: PendingProposal;
  /** Told after a decision lands, so a list can drop the row or refresh a
   *  count without this card knowing what surface it is on. */
  onDecided?: (id: string, status: string) => void;
}) {
  const [status, setStatus] = useState<string>(proposal.status);
  const [note, setNote] = useState<string | null>(null);
  /**
   * A decision that failed for a reason that is NOT worth retrying.
   *
   * Every execution-failure branch has already written the row terminal
   * `failed`, and a lost claim means another window decided it — so keeping the
   * buttons offers a control whose only possible outcome is "That proposal was
   * already failed." The card cannot know the row's new status without a read
   * it deliberately does not do, so it says so instead of guessing.
   */
  const [unresolved, setUnresolved] = useState(false);
  /**
   * What to announce once a decision made ON THIS CARD lands. Deliberately
   * null until then: the success path is otherwise a purely visual transition
   * (eyebrow swap, terminal pill, button row unmounted), so a screen-reader
   * user who pressed Approve heard "Working…" and then silence, with the
   * control they were on gone from under them. The failure path already had
   * `role="alert"`; this is its polite counterpart.
   *
   * A card that MOUNTS already-decided must stay silent — it is reporting
   * history, not an outcome — which is why this is set in `decide()` rather
   * than derived from `state`.
   */
  const [outcome, setOutcome] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  /**
   * Which button is in flight, so focus can be handed back to THAT one after a
   * retryable failure re-enables the row. Restoring to Approve after a failed
   * Decline would be worse than not restoring at all: a blind Enter on the
   * newly-focused control would approve the very call the user just refused.
   */
  const [inFlight, setInFlight] = useState<"approve" | "decline" | null>(null);
  const approveRef = useRestoreFocusAfterPending<HTMLButtonElement>(
    pending && inFlight === "approve",
  );
  const declineRef = useRestoreFocusAfterPending<HTMLButtonElement>(
    pending && inFlight === "decline",
  );

  // Stored status is not display state: with no sweep job, an undecided row
  // stays `pending` for ever, including long after it expired. The rule lives
  // in `proposal-display.ts` — the same shape (and the same injectable clock)
  // as `agentRunDisplayStatus` next door.
  const state = proposalDisplayState({ ...proposal, status });
  const terminal = state === "pending" ? null : PROPOSAL_STATE_PILL[state];
  const decidable = state === "pending" && !unresolved;

  function decide(approve: boolean) {
    if (pending) return;
    setNote(null);
    setInFlight(approve ? "approve" : "decline");
    startTransition(async () => {
      const res = await decideProposal({ id: proposal.id, approve });
      if (!res.ok) {
        setNote(res.error);
        // The buttons survive ONLY the two genuinely transient failures — the
        // read and the decision write. A retry there cannot double-execute (the
        // server claims the row under a `status = 'pending'` predicate) and
        // should not cost a page reload. Anything else already moved the row.
        if (!isRetryableDecisionError(res.error)) setUnresolved(true);
        return;
      }
      setStatus(res.data.status);
      const decided = proposalDisplayState({
        ...proposal,
        status: res.data.status,
      });
      if (decided !== "pending") {
        setOutcome(
          `Agent action ${PROPOSAL_STATE_PILL[decided].label.toLowerCase()}.`,
        );
      }
      onDecided?.(proposal.id, res.data.status);
    });
  }

  // A decided card must not still say "Awaiting approval" above its Approved
  // pill — the eyebrow states what the row IS, not what it was.
  const label = decidable ? "Awaiting approval" : "Agent action";

  return (
    <div
      role="group"
      aria-label={label}
      className="bg-surface hover:border-border-hover ease-keystone rounded-lg border p-3 text-sm transition-colors"
    >
      <div className="flex items-start justify-between gap-3">
        <Kicker>{label}</Kicker>
        {terminal ? (
          <StatusPill
            color={terminal.color}
            variant="soft"
            className="shrink-0"
          >
            {terminal.label}
          </StatusPill>
        ) : null}
      </div>

      <p className="text-foreground mt-1.5 font-medium">{proposal.summary}</p>

      {/* WHICH item / board / group. The summary is pure and holds only ids, so
          it can only say "an item" — and every id in a proposal is model-chosen.
          Resolved server-side on the owner's own RLS-scoped client
          (`proposal-targets.ts`); a name that could not be found says so rather
          than leaving the sentence reading as if nothing were missing. */}
      {proposal.target ? (
        <p
          className={
            proposal.target.name === null
              ? "text-muted-foreground mt-1 text-xs italic"
              : "text-muted-foreground mt-1 text-xs"
          }
        >
          {proposalTargetLabel(proposal.target)}
        </p>
      ) : null}

      {/* The tool name and the deadline. The name is what tells two proposals
          apart when a model re-proposed one denied write under a fresh call id
          (dedupe is keyed on the call id, so that produces two rows). */}
      <p className="text-muted-foreground mt-1 font-mono text-xs">
        {proposal.toolName}
        {decidable ? (
          <span> · {proposalExpiryLabel(proposal.expiresAt)}</span>
        ) : null}
      </p>

      {note ? (
        <p role="alert" className="text-destructive mt-2 text-xs">
          {note}
          {unresolved ? (
            <span className="text-muted-foreground"> {RELOAD_FOR_OUTCOME}</span>
          ) : null}
        </p>
      ) : null}

      {/* Mounted from the start, empty until a decision lands: a live region
          announces MUTATIONS, so one that only appears with its text already
          in it is unreliable across screen readers. */}
      <span role="status" aria-live="polite" className="sr-only">
        {outcome}
      </span>

      {decidable ? (
        <div className="mt-3 flex items-center justify-end gap-2">
          <Button
            size="sm"
            variant="ghost"
            ref={declineRef}
            onClick={() => decide(false)}
            disabled={pending}
          >
            <X className="size-3.5" /> Decline
          </Button>
          <Button
            ref={approveRef}
            size="sm"
            onClick={() => decide(true)}
            disabled={pending}
          >
            <Check className="size-3.5" />
            {pending ? "Working…" : "Approve"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
