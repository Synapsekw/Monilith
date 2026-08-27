import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { estimateTokens, MEMORY_MAX_NOTES } from "@/lib/agents/document-budget";
import { typedRpc } from "@/lib/supabase/typed-rpc";

type Client = SupabaseClient<Database>;

export type AgentMemoryNote = {
  id: string;
  key: string;
  value: string;
  origin: "agent" | "owner";
  tokenEstimate: number;
  lastRunId: string | null;
  updatedAt: string;
};

/** The four outcomes `public.agent_remember` can report. */
export type RememberStatus =
  "written" | "replaced" | "refused_owner_note" | "refused_cap";

const NOTE_COLUMNS =
  "id, key, value, origin, token_estimate, last_run_id, updated_at";

/**
 * Ceiling on the first-paint aggregate scan: 20 agents (the roster read's own
 * limit) x MEMORY_MAX_NOTES. Bounded like every other supporting read on that
 * page — never an unbounded select on a growing table.
 */
export const MEMORY_TOTALS_SCAN_LIMIT = 20 * MEMORY_MAX_NOTES;

function toNote(r: {
  id: string;
  key: string;
  value: string;
  origin: string;
  token_estimate: number;
  last_run_id: string | null;
  updated_at: string;
}): AgentMemoryNote {
  return {
    id: r.id,
    key: r.key,
    value: r.value,
    origin: r.origin as "agent" | "owner",
    tokenEstimate: r.token_estimate,
    lastRunId: r.last_run_id,
    updatedAt: r.updated_at,
  };
}

/**
 * THE read helper — used by BOTH the run loop and the owner's panel.
 *
 * One shape rather than two (documents needed a metadata-only variant because
 * a body runs to 2,000,000 characters; a whole memory is at most 50 x 500
 * chars ~= 25 KB). One shape means the prompt and the panel can never disagree
 * about what an agent knows.
 *
 * Bounded by MEMORY_MAX_NOTES over `agent_memory_agent_idx
 * (user_agent_id, updated_at desc)` — the same index `selectMemory`'s
 * freshest-first keep order wants.
 */
export async function listMemoryForAgent(
  client: Client,
  userAgentId: string,
): Promise<AgentMemoryNote[]> {
  const { data, error } = await client
    .from("agent_memory")
    .select(NOTE_COLUMNS)
    .eq("user_agent_id", userAgentId)
    .order("updated_at", { ascending: false })
    .limit(MEMORY_MAX_NOTES);
  if (error) throw new Error(`listMemoryForAgent: ${error.message}`);
  return (data ?? []).map(toNote);
}

/**
 * Keys only — for the `refused_cap` tool result, which must NAME the notes the
 * model may choose to overwrite. Selecting values on a refusal path would ship
 * 25 KB to build one sentence.
 */
export async function listMemoryKeys(
  client: Client,
  userAgentId: string,
): Promise<string[]> {
  const { data, error } = await client
    .from("agent_memory")
    .select("key")
    .eq("user_agent_id", userAgentId)
    .order("key", { ascending: true })
    .limit(MEMORY_MAX_NOTES);
  if (error) throw new Error(`listMemoryKeys: ${error.message}`);
  return (data ?? []).map((r) => r.key);
}

/**
 * The FIRST-PAINT read: per-agent note count and token total, for the WHOLE
 * roster, in one query. NEVER selects `value` — the budget meter needs only
 * the sum, and shipping 20 agents' worth of prose to render a token count
 * would be gotcha-09 in a new costume.
 *
 * Filtered through `user_agents!inner(owner_id)` because that join is what
 * keeps this ONE query for the roster instead of one per agent. RLS scopes it
 * regardless; the join is about round trips, not security.
 */
export async function listMemoryTotalsByAgent(
  client: Client,
  ownerId: string,
): Promise<Record<string, { noteCount: number; tokenTotal: number }>> {
  const { data, error } = await client
    .from("agent_memory")
    .select("user_agent_id, token_estimate, user_agents!inner(owner_id)")
    .eq("user_agents.owner_id", ownerId)
    .limit(MEMORY_TOTALS_SCAN_LIMIT);
  if (error) throw new Error(`listMemoryTotalsByAgent: ${error.message}`);

  const out: Record<string, { noteCount: number; tokenTotal: number }> = {};
  for (const r of data ?? []) {
    const bucket = (out[r.user_agent_id] ??= { noteCount: 0, tokenTotal: 0 });
    bucket.noteCount += 1;
    bucket.tokenTotal += r.token_estimate;
  }
  return out;
}

/**
 * How many notes an agent already has — the panel's `47 of 50` counter and the
 * action-side cap check. `head: true` so no rows cross the wire.
 *
 * NOT the enforcement point: the real cap lives inside `agent_remember`, where
 * the count and the insert are atomic. A check-then-insert from TypeScript is
 * a TOCTOU race whose losing side is a silently-51st note.
 */
export async function countMemoryForAgent(
  client: Client,
  userAgentId: string,
): Promise<number> {
  const { count, error } = await client
    .from("agent_memory")
    .select("id", { count: "exact", head: true })
    .eq("user_agent_id", userAgentId);
  if (error) throw new Error(`countMemoryForAgent: ${error.message}`);
  return count ?? 0;
}

/**
 * The AGENT's write, through `public.agent_remember`.
 *
 * `token_estimate` is computed HERE, server-side, from the value actually
 * being stored — never accepted from the model, whose whole incentive under
 * injection would be to under-report so a long note escapes the budget.
 *
 * Called through `typedRpc`, the canonical wrapper, never a hand-rolled
 * `client.rpc()` — and `typedRpc` is also what lets `p_run_id` be a real
 * `null` without a cast, since Postgres parameters are always nullable and the
 * codegen narrows them.
 */
export async function agentRemember(
  client: Client,
  args: {
    userAgentId: string;
    key: string;
    value: string;
    runId: string | null;
  },
): Promise<RememberStatus> {
  const { data, error } = await typedRpc(client, "agent_remember", {
    p_user_agent_id: args.userAgentId,
    p_key: args.key,
    p_value: args.value,
    p_token_estimate: estimateTokens(args.value),
    p_run_id: args.runId,
  });
  if (error) throw new Error(`agentRemember: ${error.message}`);
  return data as RememberStatus;
}

/**
 * Delete one note by (agent, key). Returns whether a row actually went, so the
 * tool can tell the model "there was no such note" instead of a false
 * confirmation. RLS scopes it to the caller; the `user_agent_id` predicate is
 * what scopes it to THIS agent — `agent_memory` is keyed on (user_agent_id,
 * key), so dropping it would delete a sibling agent's identically-keyed note.
 */
export async function agentForget(
  client: Client,
  userAgentId: string,
  key: string,
): Promise<boolean> {
  const { data, error } = await client
    .from("agent_memory")
    .delete()
    .eq("user_agent_id", userAgentId)
    .eq("key", key)
    .select("id");
  if (error) throw new Error(`agentForget: ${error.message}`);
  return (data ?? []).length > 0;
}

/**
 * The OWNER's write. Always `origin: 'owner'` and always `last_run_id: null` —
 * an owner note has no run that authored it, and stamping one would make the
 * provenance column lie.
 *
 * `onConflict` on the (user_agent_id, key) unique index, with NO origin
 * predicate: an owner may overwrite anything, including a note the agent
 * wrote. That asymmetry IS the feature — the owner's word is the fixed point,
 * and `agent_remember` refuses the mirror-image write.
 */
export async function upsertOwnerNote(
  client: Client,
  args: {
    userAgentId: string;
    orgId: string;
    ownerId: string;
    key: string;
    value: string;
  },
): Promise<void> {
  const { error } = await client.from("agent_memory").upsert(
    {
      user_agent_id: args.userAgentId,
      org_id: args.orgId,
      owner_id: args.ownerId,
      key: args.key,
      value: args.value,
      origin: "owner",
      // RECOMPUTED on every write, from the value actually being saved.
      token_estimate: estimateTokens(args.value),
      last_run_id: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_agent_id,key" },
  );
  if (error) throw new Error(`upsertOwnerNote: ${error.message}`);
}

export async function deleteMemoryRow(
  client: Client,
  id: string,
): Promise<void> {
  const { error } = await client.from("agent_memory").delete().eq("id", id);
  if (error) throw new Error(`deleteMemoryRow: ${error.message}`);
}
