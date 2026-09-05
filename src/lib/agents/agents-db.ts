import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { AgentCadence, BoardScope } from "./agent-config";
import type { AgentCapability } from "./capabilities";
import type {
  AgentRunLike,
  AgentRunSummary,
  AgentRunTrigger,
} from "./run-status";
// The DATABASE's own fan-out cap (agent_run_claim refuses a fourth sibling),
// reused as the child read's bound so the two cannot drift.
import { DELEGATE_FANOUT_MAX } from "./run-claim";

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
  /** The typeable name. Unique per owner, case-insensitively, and the only
   *  identifier a mention can carry — `user_agents.name` may contain spaces
   *  and `activeMentionQuery` terminates a token at the first one. */
  handle: string;
  /** 'builtin' is the seeded orchestrator: renameable, undeletable, and NOT
   *  counted against `max_agents_per_user`. Written only by
   *  `seed_builtin_agent`; it is absent from `authenticated`'s column grants. */
  kind: "user" | "builtin";
  template_id: string;
  instructions: string;
  board_scope: BoardScope;
  cadence: AgentCadence;
  run_at_local_hour: number;
  /**
   * The cadence's day operand, and only ever the one its cadence names:
   * `user_agents_cadence_fields` guarantees weekly rows carry a weekday, monthly
   * rows a day-of-month, and daily/weekdays rows neither. 0-6 is
   * Sunday-Saturday, matching Postgres `extract(dow …)`.
   */
  run_on_weekday: number | null;
  run_on_day_of_month: number | null;
  enabled: boolean;
  /**
   * What this agent may DO. Empty for every agent that predates the grant set,
   * and empty is the default — reading capabilities is never the permission
   * check on its own: the effective set is this INTERSECT the org's
   * `agent_capability_ceiling` INTERSECT the owner's RLS.
   */
  capabilities: AgentCapability[];
  bridge_secret_id: string | null;
  /**
   * The per-agent model PIN. Null on both means "use the org default", which is
   * every agent's backfill value. `model_id` is a CATALOG key
   * (`ai_models.model_id`) and is meaningful only alongside `provider` — the
   * run reads them straight into `runAi`'s `provider` / `requestedModel`.
   */
  provider: string | null;
  model_id: string | null;
  /**
   * Stable per-agent secret (20260826070115_agent_doc_nonce.sql), generated
   * once by the column default and never client-writable — `authenticated`'s
   * column-scoped INSERT/UPDATE grants on this table never name it, mirroring
   * `bridge_secret_id`. Threaded into `document-inject.ts`'s instructions
   * delimiter (via `run-loop.ts`) whenever this agent has documents attached,
   * so a document body forging the literal `INSTRUCTIONS_SENTINEL` cannot
   * reproduce the real, nonce-keyed marker without also knowing this value.
   */
  doc_nonce: string;
};

type Client = SupabaseClient<Database>;

const AGENT_COLS =
  "id, org_id, owner_id, name, template_id, instructions, board_scope, cadence, run_at_local_hour, enabled, bridge_secret_id, provider, model_id, capabilities, run_on_weekday, run_on_day_of_month, doc_nonce, handle, kind";

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
  // The generated Row type has `board_scope: Json` / `cadence: string` /
  // `capabilities: string[]` — wider than the app-level `BoardScope` /
  // `AgentCadence` / `AgentCapability[]` validated at the boundary
  // (agent-config.ts) and enforced by `user_agents_cadence_check` and
  // `user_agents_capabilities_known`. No column list or shape mismatch here,
  // just that narrowing.
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

/** Hard ceiling on the run-history read (spec: "the last 50 runs"). */
export const RUN_HISTORY_LIMIT = 50;

/**
 * Every column the expanded run history reads, for a root run and for a child
 * alike — one list, so the two reads cannot drift into showing different facts
 * about the same kind of row.
 */
const RUN_COLS =
  "id, status, error, fire_date, fire_hour, input_tokens, output_tokens, model_substituted, documents_omitted, memory_notes_dropped, created_at, parent_run_id, depth, trigger";

/** The `RUN_COLS` projection, as Postgres hands it back. */
type RunRow = {
  id: string;
  status: string;
  error: string | null;
  fire_date: string;
  fire_hour: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  model_substituted: boolean;
  documents_omitted: boolean;
  memory_notes_dropped: number;
  created_at: string;
  parent_run_id: string | null;
  depth: number;
  trigger: string;
};

/** snake_case row → the display shape. `trigger` is `text` in the generated
 *  types and a three-value union in the app; `user_agent_runs_trigger_known`
 *  is what makes the narrowing true, exactly as `user_agents_cadence_check`
 *  backs the `AgentCadence` narrowing above. */
function toRunSummary(r: RunRow, agentName?: string): AgentRunSummary {
  return {
    id: r.id,
    status: r.status,
    error: r.error,
    createdAt: r.created_at,
    fireDate: r.fire_date,
    fireHour: r.fire_hour,
    inputTokens: r.input_tokens,
    outputTokens: r.output_tokens,
    modelSubstituted: r.model_substituted,
    documentsOmitted: r.documents_omitted,
    memoryNotesDropped: r.memory_notes_dropped,
    parentRunId: r.parent_run_id,
    depth: r.depth,
    trigger: r.trigger as AgentRunTrigger,
    ...(agentName === undefined ? {} : { agentName }),
  };
}

/**
 * Bounded run history for ONE agent, newest first. `.eq("user_agent_id", …)`
 * plus `created_at desc` is exactly `user_agent_runs_history_idx`, so this stays
 * an index scan as the table grows (working agreement #5). Called with the
 * REQUEST-scoped client: `user_agent_runs_owner_read` is the access boundary,
 * and the explicit agent filter is the index prefix, not the security check.
 */
export async function listAgentRuns(
  client: Client,
  agentId: string,
  limit: number,
): Promise<AgentRunSummary[]> {
  const { data, error } = await client
    .from("user_agent_runs")
    .select(RUN_COLS)
    .eq("user_agent_id", agentId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`listAgentRuns: ${error.message}`);
  return (data ?? []).map((r) => toRunSummary(r));
}

/**
 * The delegated children of a PAGE of runs — the nested half of the run-history
 * tree.
 *
 * ONE batched read for the whole page (working agreement #5), never one per
 * row: `parent_run_id IN (…)` is served by `user_agent_runs_parent_idx`, which
 * is PARTIAL (`where parent_run_id is not null`) precisely because the vast
 * majority of rows are scheduled roots that belong in no such index.
 *
 * Bounded by the database's own arithmetic rather than a guessed number:
 * `agent_run_claim` refuses a fourth sibling, so `parents × DELEGATE_FANOUT_MAX`
 * is the true ceiling on what this can return, and the caller's id list is
 * itself capped at `RUN_HISTORY_LIMIT` before it gets here.
 *
 * The empty list is guarded BEFORE the client is touched — an `in ()` with no
 * values is a full scan waiting to happen, and it is the overwhelmingly common
 * case: delegation is inert on an org until an admin adds `agent.delegate` to
 * the capability ceiling.
 *
 * `user_agents!inner(name)` is what makes a child legible: it is a run of a
 * DIFFERENT agent, and without its name it reads as an anonymous second run of
 * the one whose history is open. `!inner` rather than a left join, so a row
 * whose agent the caller cannot see under RLS is dropped rather than rendered
 * nameless. Called with the REQUEST-scoped client — `user_agent_runs_owner_read`
 * is the access boundary, not the id list.
 */
export async function listChildRuns(
  client: Client,
  parentRunIds: string[],
): Promise<AgentRunSummary[]> {
  if (parentRunIds.length === 0) return [];
  const { data, error } = await client
    .from("user_agent_runs")
    .select(`${RUN_COLS}, user_agents!inner(name)`)
    .in("parent_run_id", parentRunIds)
    // Oldest first: children are read as the order the parent delegated in,
    // which is the order they actually ran (they run serially).
    .order("created_at", { ascending: true })
    .limit(parentRunIds.length * DELEGATE_FANOUT_MAX);
  if (error) throw new Error(`listChildRuns: ${error.message}`);
  return (data ?? []).map((r) => toRunSummary(r, r.user_agents.name));
}

/**
 * The most recent run per agent for the calling user, as a lookup keyed by
 * agent id — one round trip for the whole roster's last-run status.
 *
 * `get_my_agent_last_runs` is a SECURITY INVOKER `distinct on` over the same
 * history index (20260802034242), so this is bounded by the caller's agent
 * count rather than their run count. Its generated return type declares every
 * column non-null (supabase codegen does that for every `returns table`), but
 * `user_agent_runs.error` is genuinely nullable — a successful run stores NULL
 * — so `error` is widened back to `string | null` here rather than letting the
 * lie propagate into the display layer, which branches on it.
 */
export async function getMyAgentLastRuns(
  client: Client,
): Promise<Record<string, AgentRunLike>> {
  const { data, error } = await client.rpc("get_my_agent_last_runs");
  if (error) throw new Error(`getMyAgentLastRuns: ${error.message}`);
  const byAgent: Record<string, AgentRunLike> = {};
  for (const row of data ?? []) {
    byAgent[row.user_agent_id] = {
      status: row.status,
      error: (row.error as string | null) ?? null,
      createdAt: row.created_at,
    };
  }
  return byAgent;
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
    .eq("owner_id", ownerId)
    // The built-in orchestrator is given, not chosen — charging it against the
    // owner's three slots would take one away on the day this shipped.
    .neq("kind", "builtin");
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
    .eq("status", "ran")
    // The cap counts TRIGGERS, not runs. A delegated child is bounded by the
    // fan-out cap instead; counting it too would let one orchestration exhaust
    // the day.
    .is("parent_run_id", null);
  if (error) throw new Error(`countRunsToday: ${error.message}`);
  return count ?? 0;
}
