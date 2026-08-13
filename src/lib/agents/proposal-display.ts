import type { StatusPillColor } from "@/components/ui/status-pill";

/**
 * How a proposal READS on screen, as opposed to how it is stored.
 *
 * The sibling of `run-status.ts`, and it exists for the same reason: a stored
 * status is not a display state. There is deliberately no sweep job for
 * `user_agent_proposals`, so an undecided row keeps `status = 'pending'`
 * forever — long past `expires_at`, at which point the decide path will refuse
 * it. A card that read `status` alone would offer an Approve button whose only
 * possible outcome is failure.
 *
 * Clock-reading helpers with an injectable `nowMs`, exactly like `timeAgo` and
 * `agentRunDisplayStatus`: pure and unit-testable with a fixed clock, and the
 * one place the "is it still decidable?" rule is written down for the UI.
 * Deliberately free of `server-only` — the card is a client component.
 */

/**
 * The two decision failures that are worth another click, named once and shared
 * by the Server Action that produces them and the card that reads them.
 *
 * Everything else a decision can fail with is TERMINAL: every execution-failure
 * branch has already written the row `failed`, and the claim-lost branch means
 * someone else decided it. Retaining an Approve button for those produces a
 * control whose only possible outcome is "That proposal was already failed."
 */
export const LOAD_FAILED = "Couldn't load that proposal.";
export const WRITE_FAILED = "Couldn't record that decision.";

/** Is this failure worth offering the buttons again? */
export function isRetryableDecisionError(message: string): boolean {
  return message === LOAD_FAILED || message === WRITE_FAILED;
}

/** What the owner is told when a decision failed for a reason that is NOT worth
 *  retrying: the row moved on, and only a reload can show where it landed. */
export const RELOAD_FOR_OUTCOME = "Reload to see where this ended up.";

export type ProposalDisplayState =
  | "pending"
  | "approved"
  | "rejected"
  | "failed"
  | "expired";

/** Just enough of a row to decide how it renders. */
export type ProposalDisplayInput = { status: string; expiresAt: string };

export function proposalDisplayState(
  proposal: ProposalDisplayInput,
  nowMs: number = Date.now(),
): ProposalDisplayState {
  if (proposal.status !== "pending") {
    // Any stored terminal status wins, and an unrecognised one is shown as a
    // failure rather than as an actionable card: a status this UI does not know
    // is not one it should offer to execute.
    switch (proposal.status) {
      case "approved":
      case "rejected":
      case "expired":
        return proposal.status;
      default:
        return "failed";
    }
  }
  return Date.parse(proposal.expiresAt) <= nowMs ? "expired" : "pending";
}

/** Pill tone + word per terminal state. Colour is never the only signal
 *  (WCAG AA) — every tone ships with the word it means. */
export const PROPOSAL_STATE_PILL: Record<
  Exclude<ProposalDisplayState, "pending">,
  { color: StatusPillColor; label: string }
> = {
  approved: { color: "green", label: "Approved" },
  rejected: { color: "gray", label: "Declined" },
  failed: { color: "red", label: "Failed" },
  expired: { color: "yellow", label: "Expired" },
};

/** How long the owner still has. Days, not hours: the TTL is seven days and the
 *  queue is reviewed at human cadence, so a minute-accurate countdown would be
 *  precision nobody acts on. */
export function proposalExpiryLabel(
  expiresAt: string,
  nowMs: number = Date.now(),
): string {
  // FLOOR, not ceil: "Expires in 6 days" must mean the owner really has six
  // days, not that six is where five and a bit rounded up to.
  const days = Math.floor(
    (Date.parse(expiresAt) - nowMs) / (24 * 60 * 60 * 1000),
  );
  if (days <= 0) return "Expires today";
  return days === 1 ? "Expires tomorrow" : `Expires in ${days} days`;
}
