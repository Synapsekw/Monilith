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
import { RUN_HISTORY_LIMIT } from "./agents-db";
import {
  getProposalForDecision,
  listPendingProposalsForRuns,
  recordProposalDecision,
  toPendingProposal,
  type PendingProposal,
  type ProposalStatus,
} from "./proposals-db";

// Re-exported so a client component can type its props without importing a
// `server-only` module. Type-only, therefore erased — nothing about the row
// module reaches the browser bundle.
export type { PendingProposal };

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
 *   2. refuse anything not `pending` — two tabs, or a double click, must not
 *      execute the same proposal twice;
 *   3. refuse anything expired — there is no sweep job, so an undecided row
 *      keeps `status = 'pending'` forever, and the board, item or file it names
 *      may be long gone;
 *   4. look the descriptor up across BOTH descriptor sets;
 *   5. re-validate the stored input against the tool's CURRENT schema — the
 *      schema can and does move under a stored blob;
 *   6. only then execute, record the outcome, and revalidate.
 *
 * WHAT THIS DELIBERATELY DOES NOT RE-CHECK: the org's capability CEILING. The
 * ceiling is the admin half of a two-key gate over what an AGENT may do
 * unattended; this path is a person doing a thing they are already permitted to
 * do in the UI, under their own RLS. Re-imposing the agent's ceiling here would
 * refuse an owner an action they can perform by hand two clicks away.
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
 * The tools a proposal may name, keyed by name.
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
 * Module scope: the composition is static, and a duplicate name THROWS there
 * rather than resolving last-wins.
 */
const DESCRIPTORS_BY_NAME: Map<string, ToolDescriptor> = new Map(
  descriptorsFor({ extra: AGENT_ONLY_DESCRIPTORS }).map((d) => [d.name, d]),
);

/** Human-readable, and never the raw tool result — a tool's own error text can
 *  be long and is written for the model. */
const EXECUTION_FALLBACK = "That action failed.";

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
    return fail("Couldn't load that proposal.");
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
    return await finish(supabase, { id, userId: user.id, status: "rejected" });
  }

  // 4. The tool itself. A proposal outlives the tool that produced it.
  const descriptor = DESCRIPTORS_BY_NAME.get(row.toolName);
  if (!descriptor) {
    return await finish(supabase, {
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
    return await finish(supabase, {
      id,
      userId: user.id,
      status: "failed",
      result: { error: `Input no longer valid: ${validated.error.message}` },
      error:
        "This action's details are no longer valid, so it can't be approved. " +
        "Ask the agent to propose it again.",
    });
  }

  // 6. Execute — as the APPROVER, on the request-scoped client, so the owner's
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
      return await finish(supabase, {
        id,
        userId: user.id,
        status: "failed",
        result: { error: text || EXECUTION_FALLBACK },
        error: text || EXECUTION_FALLBACK,
      });
    }
  } catch (e) {
    console.error(`[agents] proposal execution threw for ${id}`, e);
    return await finish(supabase, {
      id,
      userId: user.id,
      status: "failed",
      result: { error: messageOf(e) },
      error: messageOf(e),
    });
  }

  return await finish(supabase, {
    id,
    userId: user.id,
    status: "approved",
    result: { ok: true, text },
  });
}

type Client = Awaited<ReturnType<typeof createClient>>;

/**
 * Record the outcome and revalidate, in one place.
 *
 * Every terminal branch above goes through here so no path can execute a tool
 * and then forget to write down that it did — the row is the only record that
 * the call already happened, and a missing write leaves it `pending` and
 * re-approvable.
 *
 * `error` present means the branch FAILED and that sentence is what the owner
 * reads; absent means the decision went their way and `status` is handed back.
 * Either way the row is written first: a failed execution is still a decision.
 */
async function finish(
  supabase: Client,
  args: {
    id: string;
    userId: string;
    status: ProposalStatus;
    /** What executing produced, or why it did not. Omitted for a decline. */
    result?: unknown;
    /** Set on the failure branches only. */
    error?: string;
  },
): Promise<ActionResult<{ status: ProposalStatus }>> {
  let written: boolean;
  try {
    written = await recordProposalDecision(supabase, {
      id: args.id,
      status: args.status,
      decidedBy: args.userId,
      ...(args.result === undefined ? {} : { result: args.result }),
    });
  } catch (e) {
    console.error(`[agents] proposal decision write failed for ${args.id}`, e);
    return fail("Couldn't record that decision.");
  }
  // 0 rows and no error: RLS hid the row, or it was deleted between the read
  // and the write. Reporting success would tell the owner an approval landed
  // when nothing was written.
  if (!written) return fail("Couldn't record that decision.");

  revalidatePath(SETTINGS_PATH);
  return args.error === undefined
    ? { ok: true, data: { status: args.status } }
    : fail(args.error);
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
      data: rows.map(toPendingProposal),
    };
  } catch (e) {
    // Logged, not swallowed: this read is what makes a queued approval
    // discoverable at all, so a failure has to leave a server-side trace.
    console.error("[agents] pending proposal read failed", e);
    return fail("Couldn't load pending approvals.");
  }
}
