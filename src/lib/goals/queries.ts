import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { listOrgMembersCached } from "@/lib/org/queries-cached";
import { getActiveOrgId } from "@/lib/org/active";
import { createClient } from "@/lib/supabase/server";
import { buildGoalTree, serverToday } from "@/lib/goals/progress";
import type { BoardAgg, GoalNode, GoalRow, RowOwner } from "@/lib/goals/types";

// Reuse the portfolio helpers verbatim — board status columns + readable boards
// are identical concerns for the auto_boards mapping picker.
export { getBoardStatusColumns } from "@/lib/portfolios/queries";
export { listReadableBoardsCached } from "@/lib/portfolios/queries-cached";
export type { StatusColumn } from "@/lib/portfolios/queries";

type GoalDbRow = {
  id: string;
  parent_goal_id: string | null;
  name: string;
  description: string | null;
  owner_id: string;
  workspace_id: string | null;
  progress_mode: GoalRow["progressMode"];
  status: GoalRow["status"];
  start_value: number | null;
  current_value: number | null;
  target_value: number | null;
  unit: string | null;
  percent: number | null;
  start_date: string | null;
  due_date: string | null;
  position: number;
};

function toGoalRow(r: GoalDbRow): GoalRow {
  return {
    id: r.id,
    parentGoalId: r.parent_goal_id,
    name: r.name,
    description: r.description,
    ownerId: r.owner_id,
    workspaceId: r.workspace_id,
    progressMode: r.progress_mode,
    status: r.status,
    startValue: r.start_value,
    currentValue: r.current_value,
    targetValue: r.target_value,
    unit: r.unit,
    percent: r.percent,
    startDate: r.start_date,
    dueDate: r.due_date,
    position: r.position,
  };
}

export interface GoalLink {
  boardId: string;
  doneColumnId: string | null;
  doneOptionIds: string[];
}

/** Hot-path caps (AGENTS.md: bounded reads over indexed columns). Both reads
 * truncate SILENTLY at the cap: `buildGoalTree` roots from parent_goal_id=null,
 * so a child whose parent fell past the cap is dropped, never a crash. Caps are
 * ≥10× any realistic org today; add pagination before raising them. */
export const GOALS_LIMIT = 1000;
export const GOAL_LINKS_LIMIT = 2000;

/** Board links per goal (for the auto_boards mapping editor in the drawer). */
export async function getGoalLinks(): Promise<Map<string, GoalLink[]>> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("goal_links")
    .select("goal_id, board_id, done_column_id, done_option_ids")
    .limit(GOAL_LINKS_LIMIT);
  const map = new Map<string, GoalLink[]>();
  for (const r of data ?? []) {
    const list = map.get(r.goal_id) ?? [];
    list.push({
      boardId: r.board_id,
      doneColumnId: r.done_column_id,
      doneOptionIds: Array.isArray(r.done_option_ids)
        ? (r.done_option_ids as string[])
        : [],
    });
    map.set(r.goal_id, list);
  }
  return map;
}

/** The current user's owner map (keyed by userId), for the New Goal owner picker. */
export async function getGoalOwners(): Promise<Map<string, RowOwner>> {
  const orgId = await getActiveOrgId();
  if (!orgId) return new Map();
  const members = await listOrgMembersCached(orgId);
  return new Map(members.map((m) => [m.userId, m]));
}

const GOAL_COLUMNS =
  "id, parent_goal_id, name, description, owner_id, workspace_id, progress_mode, status, start_value, current_value, target_value, unit, percent, start_date, due_date, position";

/**
 * Client-injected core: goals SELECT + goals_rollup() RPC → assembled tree.
 *
 * `ctx.owners` is a PARAMETER because the RSC path resolves it from the
 * active-org cookie via the service-client cache, while MCP resolves it over
 * the bridged client (spec §3.2: no service client on the MCP path). It accepts
 * a `Map` OR a `Promise<Map>` so a caller whose lookup is asynchronous (the RSC
 * wrapper) hands the lookup in as a `Promise.all` slot and gets it resolved
 * CONCURRENTLY with the goals/rollup reads, rather than gating them behind it —
 * the same shape `getPortfolioRowsCore` uses, for the same reason.
 *
 * `ctx.orgId` is OPTIONAL and genuinely filters. `goals` RLS is org-membership,
 * so a two-org user's read returns BOTH orgs' goals; a caller that asked about
 * one org (MCP's `list_goals(orgId)`) would otherwise get the other org's goals
 * interleaved, with `ownerName: null` because the owner map only holds the
 * asked-for org. Omitting it preserves the RSC behaviour exactly — `/goals`
 * shows every org's goals today and must keep doing so.
 */
export async function getGoalsTreeCore(
  supabase: SupabaseClient<Database>,
  ctx: {
    owners: Map<string, RowOwner> | Promise<Map<string, RowOwner>>;
    nowMs: number;
    orgId?: string;
  },
): Promise<GoalNode[]> {
  const base = supabase.from("goals").select(GOAL_COLUMNS);
  const scoped = ctx.orgId ? base.eq("org_id", ctx.orgId) : base;

  const [{ data: goals }, { data: aggs }, owners] = await Promise.all([
    scoped.order("position").limit(GOALS_LIMIT),
    supabase.rpc("goals_rollup"),
    ctx.owners,
  ]);

  const rows: GoalRow[] = (goals ?? []).map((g) => toGoalRow(g as GoalDbRow));
  const boardAggs: BoardAgg[] = (aggs ?? []).map((a) => ({
    goalId: a.goal_id,
    boardId: a.board_id,
    total: Number(a.total_items),
    done: Number(a.done_items),
  }));
  return buildGoalTree(rows, boardAggs, owners, serverToday(ctx.nowMs));
}

/** Cookie-bound wrapper — the RSC entry point. Signature unchanged.
 *
 * `getGoalOwners()` is handed over UNAWAITED so it resolves as the core's third
 * `Promise.all` slot: the owner lookup (a `listOrgMembersCached` miss is a real
 * round-trip) overlaps the goals + rollup reads instead of preceding them.
 * `createClient()` is awaited first because it is process-local, not I/O.
 *
 * No `orgId` is passed — deliberately. `/goals` shows goals across every org
 * the user belongs to, and that behaviour is unchanged. */
export async function getGoalsTree(): Promise<GoalNode[]> {
  const nowMs = Date.now();
  const supabase = await createClient();
  return getGoalsTreeCore(supabase, { owners: getGoalOwners(), nowMs });
}
