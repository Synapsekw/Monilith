import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/types/database.types";

/**
 * Access seam for `user_agent_proposals` — the durable record of a tool call an
 * agent WANTED to make but held no capability grant for. Sibling of
 * `agents-db.ts` and deliberately identical in shape: `server-only`, one narrow
 * function per access, camelCase mapping at the boundary.
 *
 * Why a table at all: a refused tool call is answered IN THE LOOP ("that needs
 * your approval — I've queued it") so an unattended 07:00 run finishes instead
 * of hanging on a human who is asleep. The proposal outlives the run, and the
 * owner decides it later.
 *
 * Writing is service-role only — `user_agent_proposals` has no INSERT policy,
 * exactly like `user_agent_runs`. Reading and deciding are owner-scoped by RLS.
 */

type Client = SupabaseClient<Database>;

/** Mirrors the `status` check constraint on the table. */
export const PROPOSAL_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "expired",
  "failed",
] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

/**
 * How long a queued proposal stays decidable. Seven days because the queue is
 * reviewed at human cadence (a weekly catch-up must still find last Monday's
 * proposals) while an approval older than that is one whose world has moved on
 * — the board, the file, the assignee may all have changed since.
 */
export const PROPOSAL_TTL_DAYS = 7;

/**
 * Ceiling on the pending-badge scan. The read is over
 * `user_agent_proposals_owner_idx` (owner_id, status, created_at desc), so it
 * is an index scan, but working agreement #5 forbids an unbounded read on a
 * growing table regardless. An owner with more than this many undecided
 * proposals has a runaway agent, not a badge problem — the tally saturates and
 * that is the honest answer.
 */
export const PENDING_PROPOSAL_SCAN_LIMIT = 500;

export type ProposalRow = {
  id: string;
  userAgentId: string;
  runId: string;
  orgId: string;
  ownerId: string;
  capability: string;
  toolName: string;
  toolCallId: string;
  input: Record<string, unknown>;
  summary: string;
  status: ProposalStatus;
  expiresAt: string;
  createdAt: string;
  result: unknown;
};

/**
 * What a run hands in. `status` and `expires_at` are absent on purpose: they
 * are stamped by `insertProposals`, so no caller can queue a proposal that is
 * born approved or born immortal.
 */
export type NewProposal = {
  userAgentId: string;
  runId: string;
  orgId: string;
  ownerId: string;
  capability: string;
  toolName: string;
  toolCallId: string;
  input: Record<string, unknown>;
  /** SERVER-derived from the validated tool input — never model-written text. */
  summary: string;
};

const PROPOSAL_COLS =
  "id, user_agent_id, run_id, org_id, owner_id, capability, tool_name, " +
  "tool_call_id, input, summary, status, expires_at, created_at, result";

/**
 * The row as it comes back, validated at the boundary. Two columns are wider in
 * the generated types than the app's vocabulary and are narrowed HERE rather
 * than cast: `status` is `string` (the check constraint is invisible to
 * codegen) and `input` is `Json` (which admits a bare string or an array). A
 * violation is a genuine corruption of a table only the service role writes, so
 * it throws instead of being coerced to a plausible default.
 */
const proposalRowSchema = z.object({
  id: z.string(),
  user_agent_id: z.string(),
  run_id: z.string(),
  org_id: z.string(),
  owner_id: z.string(),
  capability: z.string(),
  tool_name: z.string(),
  tool_call_id: z.string(),
  input: z.record(z.string(), z.unknown()),
  summary: z.string(),
  status: z.enum(PROPOSAL_STATUSES),
  expires_at: z.string(),
  created_at: z.string(),
  result: z.unknown(),
});

function toProposalRow(raw: unknown, fn: string): ProposalRow {
  const parsed = proposalRowSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`${fn}: unreadable proposal row — ${parsed.error.message}`);
  }
  const r = parsed.data;
  return {
    id: r.id,
    userAgentId: r.user_agent_id,
    runId: r.run_id,
    orgId: r.org_id,
    ownerId: r.owner_id,
    capability: r.capability,
    toolName: r.tool_name,
    toolCallId: r.tool_call_id,
    input: r.input,
    summary: r.summary,
    status: r.status,
    expiresAt: r.expires_at,
    createdAt: r.created_at,
    result: r.result ?? null,
  };
}

/**
 * Queue proposals for one run. Service-role client only — there is no
 * authenticated insert path, by design.
 *
 * `expires_at` is computed from the SAME clock that the readers compare
 * against (see `listPendingProposalsForRun`), so TTL arithmetic and expiry
 * filtering can never disagree with each other.
 *
 * A duplicate `(run_id, tool_call_id)` raises 23505 rather than being ignored:
 * the pair is unique per proposed call, so a second insert means the run
 * re-proposed a call it already queued — a bug worth hearing about, not a
 * duplicate approval card for the owner to puzzle over.
 */
export async function insertProposals(
  svc: Client,
  rows: NewProposal[],
  now: Date = new Date(),
): Promise<void> {
  if (rows.length === 0) return; // no round trip for the common (no-refusal) case
  const expiresAt = new Date(
    now.getTime() + PROPOSAL_TTL_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { error } = await svc.from("user_agent_proposals").insert(
    rows.map((r) => ({
      user_agent_id: r.userAgentId,
      run_id: r.runId,
      org_id: r.orgId,
      owner_id: r.ownerId,
      capability: r.capability,
      tool_name: r.toolName,
      tool_call_id: r.toolCallId,
      input:
        r.input as Database["public"]["Tables"]["user_agent_proposals"]["Insert"]["input"],
      summary: r.summary,
      status: "pending" satisfies ProposalStatus,
      expires_at: expiresAt,
    })),
  );
  if (error) throw new Error(`insertProposals: ${error.message}`);
}

/**
 * The undecided proposals of ONE run, oldest first (the order the agent
 * proposed them, which is the order they read as a story).
 *
 * BOTH halves of the predicate are load-bearing. There is deliberately no
 * sweep job, so an undecided row keeps `status = 'pending'` forever: filtering
 * on status alone would render an Approve button whose only possible outcome
 * is failure. Expiry is decided against the app clock rather than the
 * database's `now()` because `expires_at` was written from that same clock by
 * `insertProposals` — one clock, no skew between the two ends of the rule.
 */
export async function listPendingProposalsForRun(
  client: Client,
  runId: string,
  now: Date = new Date(),
): Promise<ProposalRow[]> {
  const { data, error } = await client
    .from("user_agent_proposals")
    .select(PROPOSAL_COLS)
    .eq("run_id", runId)
    .eq("status", "pending")
    .gt("expires_at", now.toISOString())
    .order("created_at", { ascending: true });
  if (error) throw new Error(`listPendingProposalsForRun: ${error.message}`);
  return (data ?? []).map((r) =>
    toProposalRow(r, "listPendingProposalsForRun"),
  );
}

/**
 * How many decidable proposals each of this owner's agents is waiting on,
 * keyed by agent id — one round trip for the whole roster's badge.
 *
 * Same expiry rule as `listPendingProposalsForRun`, and for the same reason: a
 * badge counting rows the decision path would refuse is a badge that lies. The
 * filter order (owner_id, status) then `created_at desc` is exactly
 * `user_agent_proposals_owner_idx`; PostgREST cannot express `group by`, so the
 * tally happens here over a bounded page.
 */
export async function countPendingProposalsByAgent(
  client: Client,
  ownerId: string,
  now: Date = new Date(),
): Promise<Record<string, number>> {
  const { data, error } = await client
    .from("user_agent_proposals")
    .select("user_agent_id")
    .eq("owner_id", ownerId)
    .eq("status", "pending")
    .gt("expires_at", now.toISOString())
    .order("created_at", { ascending: false })
    .limit(PENDING_PROPOSAL_SCAN_LIMIT);
  if (error) throw new Error(`countPendingProposalsByAgent: ${error.message}`);

  const byAgent: Record<string, number> = {};
  for (const row of data ?? []) {
    byAgent[row.user_agent_id] = (byAgent[row.user_agent_id] ?? 0) + 1;
  }
  return byAgent;
}

/**
 * One proposal, for the approve/reject path. Deliberately NOT filtered by
 * status or expiry: the decision path has to be able to LOAD a stale or
 * already-decided row so it can refuse it with an honest reason. Filtering here
 * would turn "this expired last Tuesday" into "not found".
 *
 * Called with the REQUEST-scoped client — `user_agent_proposals_owner_read` is
 * the access boundary, so a non-owner's id simply resolves to null.
 */
export async function getProposalForDecision(
  client: Client,
  id: string,
): Promise<ProposalRow | null> {
  const { data, error } = await client
    .from("user_agent_proposals")
    .select(PROPOSAL_COLS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`getProposalForDecision: ${error.message}`);
  if (!data) return null;
  return toProposalRow(data, "getProposalForDecision");
}
