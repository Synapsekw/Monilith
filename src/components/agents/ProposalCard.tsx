"use client";

import { useState, useTransition } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kicker } from "@/components/ui/kicker";
import { StatusPill } from "@/components/ui/status-pill";
import {
  PROPOSAL_STATE_PILL,
  proposalDisplayState,
  proposalExpiryLabel,
} from "@/lib/agents/proposal-display";
import {
  decideProposal,
  type PendingProposal,
} from "@/lib/agents/proposal-actions";

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
  const [pending, startTransition] = useTransition();

  // Stored status is not display state: with no sweep job, an undecided row
  // stays `pending` for ever, including long after it expired. The rule lives
  // in `proposal-display.ts` — the same shape (and the same injectable clock)
  // as `agentRunDisplayStatus` next door.
  const state = proposalDisplayState({ ...proposal, status });
  const terminal = state === "pending" ? null : PROPOSAL_STATE_PILL[state];

  function decide(approve: boolean) {
    if (pending) return;
    setNote(null);
    startTransition(async () => {
      const res = await decideProposal({ id: proposal.id, approve });
      if (!res.ok) {
        // Left decidable on purpose: the server refuses anything that is no
        // longer `pending`, so a retry cannot double-execute, and a transient
        // failure should not need a page reload to recover from.
        setNote(res.error);
        return;
      }
      setStatus(res.data.status);
      onDecided?.(proposal.id, res.data.status);
    });
  }

  // A decided card must not still say "Awaiting approval" above its Approved
  // pill — the eyebrow states what the row IS, not what it was.
  const label = state === "pending" ? "Awaiting approval" : "Agent action";

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

      {/* The tool name and the deadline. The name is what tells two proposals
          apart when a model re-proposed one denied write under a fresh call id
          (dedupe is keyed on the call id, so that produces two rows). */}
      <p className="text-muted-foreground mt-1 font-mono text-xs">
        {proposal.toolName}
        {state === "pending" ? (
          <span> · {proposalExpiryLabel(proposal.expiresAt)}</span>
        ) : null}
      </p>

      {note ? (
        <p role="alert" className="text-destructive mt-2 text-xs">
          {note}
        </p>
      ) : null}

      {state === "pending" ? (
        <div className="mt-3 flex items-center justify-end gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => decide(false)}
            disabled={pending}
          >
            <X className="size-3.5" /> Decline
          </Button>
          <Button size="sm" onClick={() => decide(true)} disabled={pending}>
            <Check className="size-3.5" />
            {pending ? "Working…" : "Approve"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
