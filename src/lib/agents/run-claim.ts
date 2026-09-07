import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { typedRpc } from "@/lib/supabase/typed-rpc";

/** The most delegations ONE run may make. Enforced in SQL by
 *  `agent_run_claim` (under a row lock, because count-then-insert is not
 *  atomic at READ COMMITTED); named here so the refusal copy and the tool
 *  description cannot drift from it. */
export const DELEGATE_FANOUT_MAX = 3;

export type ClaimOutcome =
  | "claimed"
  | "refused_bad_trigger"
  | "refused_not_owner"
  | "refused_disabled"
  | "refused_depth"
  | "refused_fanout"
  | "refused_cooldown"
  | "refused_daily_cap";

/**
 * Sentences for the MODEL and for the user, not log lines. Named refusals, the
 * `remember`/`refused_cap` lesson: a model told only "denied" re-proposes the
 * same call until it runs out of steps, so every refusal says what was wrong
 * AND what to do instead.
 */
export const CLAIM_REFUSAL_COPY: Record<
  Exclude<ClaimOutcome, "claimed">,
  string
> = {
  refused_bad_trigger: "That is not a runnable trigger.",
  refused_not_owner: "That agent does not belong to you.",
  refused_disabled:
    "That agent is switched off. Switch it on in Settings → Agents to use it.",
  refused_depth:
    "An agent you were delegated to cannot delegate again. Do this part yourself.",
  refused_fanout: `You have already delegated ${DELEGATE_FANOUT_MAX} times this run, the maximum. Finish with what you have.`,
  refused_cooldown:
    "That agent ran less than five minutes ago. Give it a moment before asking again.",
  refused_daily_cap:
    "You have used up today's agent runs for this organization.",
};

/**
 * The ONE way a non-scheduled run comes into existence. Everything the model or
 * a mention could otherwise skip — depth, fan-out, the cooldown, the daily cap,
 * ownership, the kill switch — is decided inside `agent_run_claim`, under a row
 * lock, because count-then-insert is not atomic at READ COMMITTED. This wrapper
 * adds types and copy; it must never add a check of its own, or the check that
 * matters would live in two places.
 *
 * A transport failure degrades to a refusal rather than throwing: the caller is
 * usually a tool handler mid-run, and a throw there would kill the PARENT run
 * over a child that never started. `refused_not_owner` is the honest fallback —
 * the claim did not happen, and no run id exists.
 */
export async function claimAgentRun(
  client: SupabaseClient<Database>,
  args: {
    agentId: string;
    trigger: "delegation" | "mention";
    parentRunId?: string | null;
  },
): Promise<{ outcome: ClaimOutcome; runId: string | null }> {
  const { data, error } = await typedRpc(client, "agent_run_claim", {
    p_agent_id: args.agentId,
    p_trigger: args.trigger,
    // Sent EXPLICITLY, including the null: omitting it would let the argument
    // default decide, and the RPC treats "no parent" as a materially different
    // claim (no depth, no fan-out counter) from "parent p1".
    p_parent_run_id: args.parentRunId ?? null,
  });
  if (error || !data?.[0]) {
    if (error) console.error("[agents] agent_run_claim failed:", error.message);
    return { outcome: "refused_not_owner", runId: null };
  }
  return {
    // The RPC returns `text`; the generated type is `string`. The vocabulary is
    // pinned by the function's own body, not by this cast, which exists only
    // because Postgres has no enum for it.
    outcome: data[0].outcome as ClaimOutcome,
    runId: data[0].run_id ?? null,
  };
}
