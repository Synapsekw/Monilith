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

/** The kinds of object a proposal can address — one per non-`"none"`
 *  `ToolScope`. See `proposal-targets.ts`. */
export type ProposalTargetKind = "item" | "board" | "group";

/**
 * WHICH object the stored call names, resolved for display.
 *
 * `name: null` means the read SUCCEEDED and the object was not in it — deleted,
 * or no longer visible to this reader. A target of `null` on the proposal
 * itself means no claim is being made at all: the tool addresses no single
 * object, or the resolving read failed. The two must not be conflated.
 */
export type ProposalTarget = {
  kind: ProposalTargetKind;
  name: string | null;
};

/**
 * The subset a REVIEW SURFACE may see. `input` and `result` are deliberately
 * absent: the input can carry a whole document body (`create_file`), the client
 * has no use for it, and the server-derived `summary` is the thing being
 * approved. Shipped from here rather than from the card so both surfaces and
 * the Server Action project the row identically.
 *
 * `target` is the ONE thing the summary cannot say, because
 * `proposal-summary.ts` is pure and holds only ids. It is filled in by
 * `withResolvedTargets` on the reader's own RLS-scoped client — see
 * `proposal-targets.ts` for why that is the right side of the wall.
 */
export type PendingProposal = {
  id: string;
  runId: string;
  userAgentId: string;
  toolName: string;
  capability: string;
  summary: string;
  status: ProposalStatus;
  expiresAt: string;
  createdAt: string;
  target: ProposalTarget | null;
};

/** Project a row for review. One mapper, so the two surfaces cannot disagree
 *  about what a card is allowed to know.
 *
 *  `target` is `null` here BY CONSTRUCTION: this function is pure and has
 *  nothing to resolve an id against. A display surface calls
 *  `withResolvedTargets` (which wraps this) rather than this directly. */
export function toPendingProposal(row: ProposalRow): PendingProposal {
  return {
    id: row.id,
    runId: row.runId,
    userAgentId: row.userAgentId,
    toolName: row.toolName,
    capability: row.capability,
    summary: row.summary,
    status: row.status,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    target: null,
  };
}

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
    .order("created_at", { ascending: true })
    // Bounded for the same reason its sibling counter is: one run can propose
    // up to AGENT_MAX_STEPS × parallel tool calls, and a runaway agent must not
    // turn a page render into an unbounded read.
    .limit(PENDING_PROPOSAL_SCAN_LIMIT);
  if (error) throw new Error(`listPendingProposalsForRun: ${error.message}`);
  return (data ?? []).map((r) =>
    toProposalRow(r, "listPendingProposalsForRun"),
  );
}

/**
 * The same undecided proposals, for SEVERAL runs at once.
 *
 * Exists for the run-history surface, which renders a page of runs and needs
 * each one's pending proposals: calling the singular reader per row is the N+1
 * that working agreement #5 exists to prevent. `run_id IN (…)` is served by the
 * leading column of `user_agent_proposals_call_uniq (run_id, tool_call_id)`, so
 * this is still an index scan.
 *
 * The predicate is deliberately IDENTICAL to the singular reader's — status AND
 * expiry — because the two feed the same card, and a surface that listed a row
 * the decision path would refuse renders an Approve button that can only fail.
 */
export async function listPendingProposalsForRuns(
  client: Client,
  runIds: string[],
  now: Date = new Date(),
): Promise<ProposalRow[]> {
  if (runIds.length === 0) return []; // no round trip for a runless agent
  const { data, error } = await client
    .from("user_agent_proposals")
    .select(PROPOSAL_COLS)
    .in("run_id", runIds)
    .eq("status", "pending")
    .gt("expires_at", now.toISOString())
    .order("created_at", { ascending: true })
    .limit(PENDING_PROPOSAL_SCAN_LIMIT);
  if (error) throw new Error(`listPendingProposalsForRuns: ${error.message}`);
  return (data ?? []).map((r) =>
    toProposalRow(r, "listPendingProposalsForRuns"),
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
 * CLAIM one pending proposal for a decision — the only way a row leaves
 * `pending`, and the concurrency boundary of the whole approve path.
 *
 * WHY THIS IS A CLAIM AND NOT A WRITE. A prior `select` of `status` cannot
 * arbitrate between two concurrent deciders: the owner with the same proposal
 * open in two tabs (or a slow first request and an impatient second click) has
 * both requests read `pending`, both pass every guard, and — when the update
 * goes by id alone — both go on to execute the tool. The item is created twice
 * and the second write overwrites the first one's result. The RLS UPDATE policy
 * cannot help; it says nothing about `status`.
 *
 * So the check travels WITH the update: `id = ? AND status = 'pending'`. Postgres
 * evaluates it under the row lock, exactly one statement matches, and the loser
 * gets 0 affected rows. The database is the arbiter, not a prior read.
 *
 * Returns whether this caller won. `false` covers both "someone else decided it
 * first" and "RLS hid the row" — PostgREST reports each as 0 rows and NO error,
 * and either way this caller must not execute anything.
 *
 * Called with the REQUEST-scoped client, never the service client — the whole
 * security story of the approve path is that it runs as the approver. RLS
 * (`user_agent_proposals_owner_decide`, whose `with check` re-asserts
 * `owner_id`) remains the ownership boundary on top of this predicate.
 *
 * `decided_at`/`decided_by` are stamped here rather than by the caller so no
 * decision path can forget the audit half of the write.
 */
export async function claimProposalDecision(
  client: Client,
  args: {
    id: string;
    status: ProposalStatus;
    /** The approver — `auth.uid()`, which the policy independently enforces. */
    decidedBy: string;
    /** Set on the paths that already know their outcome, and on the approve
     *  path as a placeholder for a claim whose execution never returns.
     *  Omitted for a plain rejection, which produces nothing. */
    result?: unknown;
  },
  now: Date = new Date(),
): Promise<boolean> {
  const patch: Record<string, unknown> = {
    status: args.status,
    decided_at: now.toISOString(),
    decided_by: args.decidedBy,
  };
  if (args.result !== undefined) patch.result = args.result;

  const { data, error } = await client
    .from("user_agent_proposals")
    .update(patch as never)
    .eq("id", args.id)
    // THE predicate. Without it two concurrent approvals both execute.
    .eq("status", "pending")
    .select("id");
  if (error) throw new Error(`claimProposalDecision: ${error.message}`);
  return (data ?? []).length > 0;
}

/**
 * Write the OUTCOME of a decision this request already claimed.
 *
 * Deliberately by id alone, with no `status = 'pending'` predicate: the claim
 * above already moved the row out of `pending`, so re-asserting it here would
 * throw away the result of a tool call that really happened. This is safe only
 * because a caller reaches it exclusively after winning a claim — there is no
 * other call site, and there must not be.
 *
 * `decided_at`/`decided_by` are NOT restamped. The claim recorded when the
 * human decided; the outcome merely lands later.
 */
export async function settleProposalOutcome(
  client: Client,
  args: { id: string; status: ProposalStatus; result: unknown },
): Promise<boolean> {
  const { data, error } = await client
    .from("user_agent_proposals")
    .update({ status: args.status, result: args.result } as never)
    .eq("id", args.id)
    .select("id");
  if (error) throw new Error(`settleProposalOutcome: ${error.message}`);
  return (data ?? []).length > 0;
}

/**
 * One proposal, for the approve/reject path. Deliberately NOT filtered by
 * status or expiry: the decision path has to be able to LOAD a stale or
 * already-decided row so it can refuse it with an honest reason. Filtering here
 * would turn "this expired last Tuesday" into "not found".
 *
 * This read is for the MESSAGE, never for the decision — `claimProposalDecision`
 * is what actually arbitrates. Anything decided between this read and that claim
 * is caught there.
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
