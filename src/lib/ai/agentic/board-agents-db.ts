import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { AutomationAction } from "@/lib/validations/automations";
import type {
  AutopilotCadence,
  BoardAgentConfig,
  BoardAgentSettings,
} from "./autopilot-config";

/**
 * Migration-gate seam for the F14 `board_agents` family. This task's migration
 * (`<stamp>_board_agents.sql`) adds `board_agents`, `board_agent_runs`, the
 * `board_agent_apply` confined applier, and `platform_agent_user_id()` — but the
 * regenerated `database.types.ts` only lands AFTER the USER applies the migration
 * to DEV. Until then these tables/RPCs are not in the typed client union, so every
 * access to them is narrowed HERE (and only here) — the one documented cast, kept
 * out of the endpoint/action code so those stay readable. Client-safe config
 * (schemas, cadences, task vocabulary) lives in `autopilot-config.ts`.
 */

export type BoardAgentRow = {
  id: string;
  org_id: string;
  board_id: string;
  enabled: boolean;
  cadence: AutopilotCadence;
  run_at_local_hour: number;
  config: BoardAgentConfig;
  created_by: string | null;
};

export type BoardAgentRunInsert = {
  board_agent_id: string;
  org_id: string;
  board_id: string;
  fire_date: string;
  // The local hour of the fire — part of the idempotency key so an `hourly`
  // agent can run every hour (a `daily` agent fires once, at run_at_local_hour).
  fire_hour: number;
  status: "ran" | "skipped" | "error";
  actions?: unknown;
  warnings?: unknown;
  error?: string | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
};

type DbErr = { message: string } | null;

// ── narrow cast helpers (the only place `board_agents*` bypasses the typed client)
type SelectEqSingle<Row> = {
  select: (cols: string) => {
    eq: (
      col: string,
      val: string,
    ) => {
      maybeSingle: () => Promise<{ data: Row | null; error: DbErr }>;
    };
  };
};
type SelectEq3Single<Row> = {
  select: (cols: string) => {
    eq: (
      col: string,
      val: string,
    ) => {
      eq: (
        col2: string,
        val2: string,
      ) => {
        eq: (
          col3: string,
          val3: number,
        ) => {
          maybeSingle: () => Promise<{ data: Row | null; error: DbErr }>;
        };
      };
    };
  };
};

const svcAny = (svc: SupabaseClient<Database>) =>
  svc as unknown as {
    from: (table: string) => unknown;
    rpc: (fn: string, args?: Record<string, unknown>) => unknown;
  };

/** Load a board agent by its id (service or RLS client — RLS scopes reads). */
export async function getBoardAgentById(
  svc: SupabaseClient<Database>,
  id: string,
): Promise<BoardAgentRow | null> {
  const q = svcAny(svc).from("board_agents") as SelectEqSingle<BoardAgentRow>;
  const { data } = await q
    .select(
      "id, org_id, board_id, enabled, cadence, run_at_local_hour, config, created_by",
    )
    .eq("id", id)
    .maybeSingle();
  return data;
}

/** Load the (at most one) board agent configured for a board. */
export async function getBoardAgentByBoard(
  svc: SupabaseClient<Database>,
  boardId: string,
): Promise<BoardAgentRow | null> {
  const q = svcAny(svc).from("board_agents") as SelectEqSingle<BoardAgentRow>;
  const { data } = await q
    .select(
      "id, org_id, board_id, enabled, cadence, run_at_local_hour, config, created_by",
    )
    .eq("board_id", boardId)
    .maybeSingle();
  return data;
}

/** Idempotency probe: has this agent already run for this fire slot (date+hour)? */
export async function findBoardAgentRun(
  svc: SupabaseClient<Database>,
  agentId: string,
  fireDate: string,
  fireHour: number,
): Promise<{ id: string } | null> {
  const q = svcAny(svc).from("board_agent_runs") as SelectEq3Single<{
    id: string;
  }>;
  const { data } = await q
    .select("id")
    .eq("board_agent_id", agentId)
    .eq("fire_date", fireDate)
    .eq("fire_hour", fireHour)
    .maybeSingle();
  return data;
}

/** Write one audit row (mirrors the automation_runs discipline). */
export async function insertBoardAgentRun(
  svc: SupabaseClient<Database>,
  row: BoardAgentRunInsert,
): Promise<DbErr> {
  const t = svcAny(svc).from("board_agent_runs") as {
    insert: (r: BoardAgentRunInsert) => Promise<{ error: DbErr }>;
  };
  const { error } = await t.insert(row);
  return error;
}

/** The platform bot's user id — the truthful author of agent-written comments /
 *  notifications (spec §4.3). Resolved in SQL via `platform_agent_user_id()`. */
export async function getPlatformAgentUserId(
  svc: SupabaseClient<Database>,
): Promise<string | null> {
  const call = svcAny(svc).rpc("platform_agent_user_id") as Promise<{
    data: string | null;
    error: DbErr;
  }>;
  const { data } = await call;
  return data;
}

/** Apply ONE chosen action through the confined `board_agent_apply` definer — the
 *  ONLY write path (spec §4.3). Re-applies the per-action guards, authors as the
 *  platform bot, returns the outcome text. Never a raw write from the endpoint. */
export async function applyBoardAgentAction(
  svc: SupabaseClient<Database>,
  args: { agentId: string; itemId: string; action: AutomationAction },
): Promise<string> {
  const call = svcAny(svc).rpc("board_agent_apply", {
    p_agent: args.agentId,
    p_item: args.itemId,
    p_action: args.action,
  }) as Promise<{ data: string | null; error: DbErr }>;
  const { data, error } = await call;
  if (error) throw new Error(`board_agent_apply failed: ${error.message}`);
  return data ?? "ai_skipped";
}

/** Upsert the board's agent settings (admin-only via RLS). */
export async function upsertBoardAgent(
  svc: SupabaseClient<Database>,
  args: {
    orgId: string;
    boardId: string;
    createdBy: string;
    settings: BoardAgentSettings;
  },
): Promise<DbErr> {
  const t = svcAny(svc).from("board_agents") as {
    upsert: (
      r: Record<string, unknown>,
      opts: { onConflict: string },
    ) => Promise<{ error: DbErr }>;
  };
  const { error } = await t.upsert(
    {
      org_id: args.orgId,
      board_id: args.boardId,
      created_by: args.createdBy,
      enabled: args.settings.enabled,
      cadence: args.settings.cadence,
      run_at_local_hour: args.settings.runAtLocalHour,
      config: { tasks: args.settings.tasks } satisfies BoardAgentConfig,
    },
    { onConflict: "board_id" },
  );
  return error;
}
