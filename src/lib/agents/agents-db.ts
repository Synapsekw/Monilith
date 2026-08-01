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

export type UserAgentRunInsert = {
  user_agent_id: string;
  org_id: string;
  owner_id: string;
  fire_date: string;
  fire_hour: number;
  status: "ran" | "skipped" | "error";
  error?: string | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
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

export async function insertUserAgentRun(
  client: Client,
  row: UserAgentRunInsert,
): Promise<void> {
  // `.insert()` structurally can't be wrapped by the typed-rpc helper; the cast
  // is the repo's established escape hatch for this exact site (see
  // board-agents-db.ts), not a loosening of the row shape above.
  const { error } = await client.from("user_agent_runs").insert(row as never);
  if (error) throw new Error(`insertUserAgentRun: ${error.message}`);
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

/** Cap support: how many agents this person already owns. */
export async function countAgentsForOwner(
  client: Client,
  ownerId: string,
): Promise<number> {
  const { count, error } = await client
    .from("user_agents")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", ownerId);
  if (error) throw new Error(`countAgentsForOwner: ${error.message}`);
  return count ?? 0;
}

/** Cap support: how many runs this person's agents have made today. */
export async function countRunsToday(
  client: Client,
  ownerId: string,
  fireDate: string,
): Promise<number> {
  const { count, error } = await client
    .from("user_agent_runs")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", ownerId)
    .eq("fire_date", fireDate)
    .eq("status", "ran");
  if (error) throw new Error(`countRunsToday: ${error.message}`);
  return count ?? 0;
}
