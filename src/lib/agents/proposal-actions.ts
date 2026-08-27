"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
// Canonical shared result type — never re-declare locally (AGENTS.md invariant).
import { type ActionResult, fail } from "@/lib/actions/result";
import type { ToolDescriptor } from "@/lib/mcp/tools/descriptor";
import { descriptorsFor } from "./tool-descriptors";
import { AGENT_ONLY_DESCRIPTORS } from "./agent-only-tools";
import { makeMemoryDescriptors } from "./memory-tools";
import { RUN_HISTORY_LIMIT } from "./agents-db";
// The two messages a card may RETRY — shared with the card rather than
// duplicated as literals, so "is this worth another click?" has one answer.
import { LOAD_FAILED, WRITE_FAILED } from "./proposal-display";
import {
  claimProposalDecision,
  getProposalForDecision,
  listPendingProposalsForRuns,
  settleProposalOutcome,
  type PendingProposal,
  type ProposalStatus,
} from "./proposals-db";
import { withResolvedTargets } from "./proposal-targets";

// `PendingProposal` is re-exported from `./proposal-display`, NOT from here.
// A `"use server"` module may export only async functions: its export clauses
// are enumerated by the server-actions transform regardless of TypeScript's
// `type` modifier, so re-exporting a type here registers a server reference to
// a binding the type pass erases — a ReferenceError at module evaluation.
// Guard: src/test/use-server-exports.test.ts.

/**
 * The human half of the propose-then-approve loop.
 *
 * An agent run denies an ungranted tool call IN THE LOOP, writes a
 * `user_agent_proposals` row and finishes — that is what lets an unattended
 * 07:00 run complete instead of waiting on someone who is asleep. This module
 * is the other half: without it a proposal is a row nobody can act on, and the
 * model has told the owner "Recorded for your approval." about something they
 * cannot approve.
 *
 * WHY THE ORDER IN `decideProposal` IS THE SECURITY PROPERTY. What gets
 * executed here is a blob of input a LANGUAGE MODEL chose, which has been
 * sitting in Postgres for up to seven days, and it runs with the APPROVER's
 * privileges. So, in order and without exception:
 *
 *   1. load the row on the REQUEST-scoped client — RLS
 *      (`user_agent_proposals_owner_read`) is the ownership check, and a
 *      non-owner's id resolves to null rather than to someone else's row;
 *   2. refuse anything not `pending` — for the MESSAGE only: this read says
 *      "already approved" instead of "not found". It is not what stops a second
 *      decision; see step 6;
 *   3. refuse anything expired — there is no sweep job, so an undecided row
 *      keeps `status = 'pending'` forever, and the board, item or file it names
 *      may be long gone;
 *   4. look the descriptor up across BOTH descriptor sets;
 *   5. re-validate the stored input against the tool's CURRENT schema — the
 *      schema can and does move under a stored blob;
 *   6. CLAIM the row — `update … where id = ? and status = 'pending'`. Steps 1–3
 *      are reads, and reads cannot arbitrate: two tabs both see `pending`, both
 *      pass every guard, and both would execute. The predicate travels with the
 *      write, so Postgres picks the winner and the loser gets 0 rows;
 *   7. only then execute, and
 *   8. record the outcome and revalidate.
 *
 * Every branch that ends a proposal's life — decline, unknown tool, stale input,
 * approve — takes that same claim, so `pending → terminal` happens in exactly
 * one place.
 *
 * WHAT THIS DELIBERATELY DOES NOT RE-CHECK: the org's capability CEILING. The
 * ceiling is the admin half of a two-key gate over what an AGENT may do
 * unattended; this path is a person doing a thing they are already permitted to
 * do in the UI, under their own RLS. Re-imposing the agent's ceiling here would
 * refuse an owner an action they can perform by hand two clicks away.
 *
 * NOR THE AGENT'S `board_scope`, and for the same reason — but note the
 * asymmetry, because it is not obvious. The RUN path enforces scope in the tool
 * wrapper (`buildAgentTools` → `isBoardInScope`), so an ungranted call is
 * recorded as a proposal only if it was in scope at the time. This path applies
 * no scope check at all, which makes the un-granted route momentarily LESS
 * constrained than the granted one: an approval executes wherever the approver's
 * RLS reaches.
 *
 * That is the intended reading. `board_scope` is the OWNER's own stated
 * preference about their agent, not a security boundary (`board-scope-guard.ts`
 * says so outright) — and this is the owner, in a browser, deciding one action
 * by hand. It is also inert today: the agent editor hard-codes `mode: "all"`,
 * so only a hand-crafted `createAgent` can store `mode: "list"`. THE DAY A
 * SCOPE PICKER SHIPS, revisit this paragraph rather than the code by reflex:
 * the question to answer is whether "limit this agent to these boards" is meant
 * to constrain the AGENT (leave this as is) or the WORK IT PROPOSES (then a
 * scope check belongs here, and the proposal must carry the scope it was
 * recorded under, since the agent's own may have changed since).
 */

const SETTINGS_PATH = "/settings/agents";

const decideSchema = z.object({
  id: z.string().uuid(),
  approve: z.boolean(),
});

/** Bounded on the way in, to exactly the page the run-history surface renders:
 *  an unbounded id list from a client would be an unbounded `IN (…)`. */
const runIdsSchema = z.array(z.string().uuid()).max(RUN_HISTORY_LIMIT);

/**
 * The tools THIS proposal could have named, resolved PER ROW.
 *
 * `descriptorsFor({ extra: AGENT_ONLY_DESCRIPTORS })` is the ONE composition
 * both the agent's tool set and its grant gate derive from, so this lookup sees
 * exactly the tools a run could have proposed — including `create_file` and
 * `create_automation`, which are NOT in `ALL_TOOL_DESCRIPTORS`. Built from the
 * catalog alone, every `create_file` proposal would be permanently
 * un-approvable. `agentExcluded` tools are dropped by that function, so
 * `create_attachment_upload` is absent and a row naming it fails closed —
 * correct, because an agent is never offered it and can never legitimately
 * propose it.
 *
 * IT CANNOT BE A MODULE CONSTANT ANY MORE (Spec 2c). `remember` and `forget`
 * are built per run, closed over the agent id, because `ToolInvokeContext`
 * carries neither an agent id nor a run id — so the lookup has to know WHICH
 * agent's proposal it is approving. Left at module scope, every `remember`
 * proposal would hit the "Unknown tool" branch below and be permanently
 * un-approvable: exactly the bug this comment already warned about for
 * `create_file`, in a new costume.
 *
 * `row.userAgentId` is SERVER-READ from the proposal row — never client input —
 * so this cannot be steered. `runId: null` because the note is being written by
 * the owner's APPROVAL, not by the run that proposed it; stamping the original
 * run id would claim a run wrote something it was actually denied.
 *
 * A duplicate name still THROWS inside `descriptorsFor` rather than resolving
 * last-wins; that is now a per-call check instead of a per-module one, which is
 * strictly more coverage for the same cost.
 */
function descriptorFor(row: {
  userAgentId: string;
  toolName: string;
}): ToolDescriptor | undefined {
  return descriptorsFor({
    extra: [
      ...AGENT_ONLY_DESCRIPTORS,
      ...makeMemoryDescriptors({ userAgentId: row.userAgentId, runId: null }),
    ],
  }).find((d) => d.name === row.toolName);
}

/** Human-readable, and never the raw tool result — a tool's own error text can
 *  be long and is written for the model. */
const EXECUTION_FALLBACK = "That action failed.";

/** The loser of a claim. Deliberately distinct from the pre-read's "already
 *  <status>" message: this one means the row was decided in the moments AFTER
 *  this request read it, which is the two-tab case. */
const CLAIM_LOST =
  "That proposal was just decided in another window. Reload to see the outcome.";

/**
 * Stamped on the row at CLAIM time, before the tool runs, and overwritten by
 * whichever outcome follows. It is only ever the final value when the process
 * died mid-execution — and then it is the truthful one, because nobody knows
 * whether the write landed. Same posture as `claimRun`'s CLAIM_PLACEHOLDER in
 * the run route: claim conservatively, upgrade on success.
 */
const EXECUTION_INCOMPLETE =
  "This approval did not finish. It may or may not have taken effect — check " +
  "before trying again.";

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : EXECUTION_FALLBACK;
}

/**
 * Approve or decline one proposal.
 *
 * Approving EXECUTES the stored call; declining writes `rejected` and executes
 * nothing. Either way the row leaves `pending`, so the card and the roster
 * badge stop offering it.
 */
export async function decideProposal(input: {
  id: string;
  approve: boolean;
}): Promise<ActionResult<{ status: ProposalStatus }>> {
  const parsed = decideSchema.safeParse(input);
  if (!parsed.success) return fail("That proposal isn't valid.");
  const { id, approve } = parsed.data;

  const user = await requireUser();
  const supabase = await createClient();

  let row;
  try {
    // 1. RLS is the ownership check. No `.eq("owner_id", …)` is needed and none
    //    would add anything: the policy is `owner_id = auth.uid()`.
    row = await getProposalForDecision(supabase, id);
  } catch (e) {
    console.error(`[agents] proposal read failed for ${id}`, e);
    return fail(LOAD_FAILED);
  }
  if (!row) return fail("That proposal is no longer available.");

  // 2. Already decided. Reported with the status it holds, so a second tab
  //    says something true rather than "not found".
  if (row.status !== "pending") {
    return fail(`That proposal was already ${row.status}.`);
  }

  // 3. Expired. The row is left `pending` on purpose: it is the historical
  //    record of what the agent asked for, and rewriting it here would be this
  //    path inventing the sweep job the design deliberately does not have.
  if (Date.parse(row.expiresAt) <= Date.now()) {
    return fail(
      "That proposal expired. Ask the agent again, or grant it the capability.",
    );
  }

  // Declining is the cheap path — nothing is looked up and nothing runs.
  if (!approve) {
    return await claimAndFinish(supabase, {
      id,
      userId: user.id,
      status: "rejected",
    });
  }

  // 4. The tool itself. A proposal outlives the tool that produced it.
  const descriptor = descriptorFor(row);
  if (!descriptor) {
    return await claimAndFinish(supabase, {
      id,
      userId: user.id,
      status: "failed",
      result: { error: `Unknown tool "${row.toolName}".` },
      error: `${row.toolName} is no longer available, so this can't be approved.`,
    });
  }

  // 5. The stored blob against the CURRENT schema. Days may have passed; a tool
  //    that tightened its input would otherwise execute on a shape it no longer
  //    accepts, and the descriptors' handlers cast rather than parse.
  const validated = z.object(descriptor.inputSchema).safeParse(row.input);
  if (!validated.success) {
    return await claimAndFinish(supabase, {
      id,
      userId: user.id,
      status: "failed",
      result: { error: `Input no longer valid: ${validated.error.message}` },
      error:
        "This action's details are no longer valid, so it can't be approved. " +
        "Ask the agent to propose it again.",
    });
  }

  // 6. CLAIM THE ROW BEFORE EXECUTING. Everything above is a read, and a read
  //    cannot arbitrate between two tabs: both would see `pending`, both would
  //    reach this line, and the tool would run twice. The claim moves the row
  //    out of `pending` under a `status = 'pending'` predicate, so the database
  //    picks the winner. It claims to `failed` — the conservative placeholder —
  //    so a process that dies mid-execution leaves a row that reads "this did
  //    not complete" rather than an approval that never happened.
  let claimed: boolean;
  try {
    claimed = await claimProposalDecision(supabase, {
      id,
      decidedBy: user.id,
      status: "failed",
      result: { error: EXECUTION_INCOMPLETE },
    });
  } catch (e) {
    console.error(`[agents] proposal claim failed for ${id}`, e);
    return fail(WRITE_FAILED);
  }
  if (!claimed) return fail(CLAIM_LOST);

  // 7. Execute — as the APPROVER, on the request-scoped client, so the owner's
  //    RLS remains the real boundary exactly as it is during a run.
  let text: string;
  try {
    const result = await descriptor.invoke(
      { getClient: async () => supabase, actorId: user.id },
      // The one narrow cast the descriptor indirection costs, exactly as
      // `buildAgentTools` pays it: `z.object(rawShape)` parses to the shape's
      // own type, and every handler re-casts to the arguments it declares.
      // Crucially this is the PARSED value, never `row.input` — the whole point
      // of step 5.
      validated.data as Record<string, unknown>,
    );
    text = result.content.map((c) => c.text).join("\n");
    if (result.isError) {
      return await settle(supabase, id, "failed", {
        error: text || EXECUTION_FALLBACK,
      });
    }
  } catch (e) {
    console.error(`[agents] proposal execution threw for ${id}`, e);
    return await settle(supabase, id, "failed", { error: messageOf(e) });
  }

  // 8. Record what executing produced. The row is already claimed, so this
  //    write carries no pending predicate — re-asserting one would discard the
  //    outcome of a call that really happened.
  return await settle(supabase, id, "approved", { ok: true, text });
}

type Client = Awaited<ReturnType<typeof createClient>>;

/**
 * Claim the row for a decision that needs no execution, and revalidate.
 *
 * The three branches that use it — decline, unknown tool, stale input — all
 * move a pending row straight to its terminal state, so the claim IS the whole
 * write. They go through one helper so no path can decide a proposal without
 * the `status = 'pending'` predicate that arbitrates concurrent deciders.
 *
 * `error` present means the branch FAILED and that sentence is what the owner
 * reads; absent means the decision went their way and `status` is handed back.
 * Either way the row is written first: a refusal is still a decision.
 */
async function claimAndFinish(
  supabase: Client,
  args: {
    id: string;
    userId: string;
    status: ProposalStatus;
    /** Why this branch is terminal. Omitted for a decline, which produces
     *  nothing. */
    result?: unknown;
    /** Set on the failure branches only. */
    error?: string;
  },
): Promise<ActionResult<{ status: ProposalStatus }>> {
  let claimed: boolean;
  try {
    claimed = await claimProposalDecision(supabase, {
      id: args.id,
      status: args.status,
      decidedBy: args.userId,
      ...(args.result === undefined ? {} : { result: args.result }),
    });
  } catch (e) {
    console.error(`[agents] proposal decision write failed for ${args.id}`, e);
    return fail(WRITE_FAILED);
  }
  // 0 rows and no error covers two different stories, and neither is success:
  // RLS hid the row (or it is gone), or another request decided it first.
  if (!claimed) return fail(CLAIM_LOST);

  revalidatePath(SETTINGS_PATH);
  return args.error === undefined
    ? { ok: true, data: { status: args.status } }
    : fail(args.error);
}

/**
 * Write the outcome of an execution this request already claimed.
 *
 * Separate from the claim because it must NOT re-assert `status = 'pending'`:
 * the row stopped being pending the moment this request won it, and re-checking
 * would throw away the record of a tool call that has already taken effect.
 */
async function settle(
  supabase: Client,
  id: string,
  status: ProposalStatus,
  result: unknown,
): Promise<ActionResult<{ status: ProposalStatus }>> {
  let written: boolean;
  try {
    written = await settleProposalOutcome(supabase, { id, status, result });
  } catch (e) {
    console.error(`[agents] proposal outcome write failed for ${id}`, e);
    written = false;
  }
  // The tool ALREADY ran. There is nothing to undo, so this reports the real
  // outcome either way, and a lost write leaves the claim's own "did not
  // finish" placeholder on the row — the honest reading of an outcome nobody
  // recorded.
  //
  // KNOWN, ACCEPTED DIVERGENCE: in that one case the card renders "Approved"
  // (the truth — the call executed) while the ROW still says `failed` until
  // someone reloads. This is not a bug to fix by returning a failure: telling
  // the owner their approval failed when the item was created would send them
  // to create it a second time. The log line above is the trace that explains a
  // row whose status and effect disagree.
  if (!written) {
    console.error(`[agents] proposal ${id} executed but its outcome was lost`);
  }

  revalidatePath(SETTINGS_PATH);
  if (status === "approved") return { ok: true, data: { status } };
  const reason = (result as { error?: unknown })?.error;
  return fail(typeof reason === "string" ? reason : EXECUTION_FALLBACK);
}

/**
 * The undecided proposals belonging to a page of runs — the read behind the
 * cards in the run-history surface.
 *
 * ONE indexed read for the whole page (working agreement #5), never one per
 * run. RLS scopes it to the caller, so a run id that is not theirs simply
 * contributes nothing.
 */
export async function getPendingProposals(
  runIds: string[],
): Promise<ActionResult<PendingProposal[]>> {
  const parsed = runIdsSchema.safeParse(runIds);
  if (!parsed.success) return fail("Couldn't load pending approvals.");
  await requireUser();
  const supabase = await createClient();
  try {
    const rows = await listPendingProposalsForRuns(supabase, parsed.data);
    return {
      ok: true,
      // `input` and `result` are dropped by the shared projection, not by an
      // inline literal here: the briefing-thread surface reads the same rows,
      // and a card must never receive a document body it has no use for.
      //
      // `withResolvedTargets` wraps that projection and adds the ONE thing the
      // server-derived summary cannot say — WHICH item, board or group the call
      // names. At most three further indexed reads for the whole page, on this
      // same request-scoped client, so RLS decides what can be named.
      data: await withResolvedTargets(supabase, rows),
    };
  } catch (e) {
    // Logged, not swallowed: this read is what makes a queued approval
    // discoverable at all, so a failure has to leave a server-side trace.
    console.error("[agents] pending proposal read failed", e);
    return fail("Couldn't load pending approvals.");
  }
}
