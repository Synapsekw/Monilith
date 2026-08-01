import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { BoardScope } from "./agent-config";

/**
 * Access seam for the personal-agent family (`user_agents`, `user_agent_runs`).
 * Every access is narrowed HERE and only here, so endpoint and action code stays
 * readable and the row shapes live in one place. Mirrors `board-agents-db.ts`.
 */

export type UserAgentRow = {
  id: string;
  org_id: string;
  owner_id: string;
  name: string;
  template_id: string;
  instructions: string;
  board_scope: BoardScope;
  cadence: "daily";
  run_at_local_hour: number;
  enabled: boolean;
  bridge_secret_id: string | null;
};

type Client = SupabaseClient<Database>;

const AGENT_COLS =
  "id, org_id, owner_id, name, template_id, instructions, board_scope, cadence, run_at_local_hour, enabled, bridge_secret_id";

export async function getUserAgentById(
  client: Client,
  id: string,
): Promise<UserAgentRow | null> {
  const { data, error } = await client
    .from("user_agents")
    .select(AGENT_COLS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`getUserAgentById: ${error.message}`);
  // The generated Row type has `board_scope: Json` / `cadence: string` — narrower
  // than the app-level `BoardScope` / `"daily"` literal validated at the boundary
  // (agent-config.ts). No column list or shape mismatch here, just that widening.
  return (data as UserAgentRow | null) ?? null;
}

/** Idempotency probe: has this exact fire slot already produced a run? */
export async function findUserAgentRun(
  client: Client,
  agentId: string,
  fireDate: string,
  fireHour: number,
): Promise<{ id: string } | null> {
  const { data, error } = await client
    .from("user_agent_runs")
    .select("id")
    .eq("user_agent_id", agentId)
    .eq("fire_date", fireDate)
    .eq("fire_hour", fireHour)
    .maybeSingle();
  if (error) throw new Error(`findUserAgentRun: ${error.message}`);
  return (data as { id: string } | null) ?? null;
}

export async function setAgentBridgeSecret(
  client: Client,
  agentId: string,
  secretId: string,
): Promise<void> {
  const { error } = await client
    .from("user_agents")
    .update({ bridge_secret_id: secretId } as never)
    .eq("id", agentId);
  if (error) throw new Error(`setAgentBridgeSecret: ${error.message}`);
}

/** Cap support: how many agents this person already owns IN THIS ORG. The cap
 *  itself (`org_ai_settings.max_agents_per_user`) is per-org configuration, and
 *  a person can belong to multiple orgs (`getUserOrgs()` returns a list) — an
 *  unscoped count would let agents in one org consume another org's allowance,
 *  or a busy second org silently starve the first. Always org_id-then-owner_id,
 *  matching the `.eq("org_id", …).eq("owner_id"/"user_id", …)` filter order used
 *  throughout the repo (e.g. `boards/autopilot-actions.ts`). */
export async function countAgentsForOwner(
  client: Client,
  orgId: string,
  ownerId: string,
): Promise<number> {
  const { count, error } = await client
    .from("user_agents")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("owner_id", ownerId);
  if (error) throw new Error(`countAgentsForOwner: ${error.message}`);
  return count ?? 0;
}

/** Cap support: how many runs this person's agents have made today IN THIS
 *  ORG. Same org-scoping rationale as `countAgentsForOwner` — the daily cap is
 *  per-org configuration, so runs in a different org must never count against
 *  it. */
export async function countRunsToday(
  client: Client,
  orgId: string,
  ownerId: string,
  fireDate: string,
): Promise<number> {
  const { count, error } = await client
    .from("user_agent_runs")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("owner_id", ownerId)
    .eq("fire_date", fireDate)
    .eq("status", "ran");
  if (error) throw new Error(`countRunsToday: ${error.message}`);
  return count ?? 0;
}
