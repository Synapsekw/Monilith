import "server-only";

import { listOrgMembers } from "@/lib/boards/queries";
import { getUserOrgs } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { buildGoalTree, serverToday } from "@/lib/goals/progress";
import type { BoardAgg, GoalNode, GoalRow, RowOwner } from "@/lib/goals/types";

// Reuse the portfolio helpers verbatim — board status columns + readable boards
// are identical concerns for the auto_boards mapping picker.
export { getBoardStatusColumns, listReadableBoards } from "@/lib/portfolios/queries";
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

/** The current user's owner map (keyed by userId), for the New Goal owner picker. */
export async function getGoalOwners(): Promise<Map<string, RowOwner>> {
  const orgs = await getUserOrgs();
  const orgId = orgs[0]?.id;
  if (!orgId) return new Map();
  const members = await listOrgMembers(orgId);
  return new Map(members.map((m) => [m.userId, m]));
}

/** One bounded pass: goals SELECT + goals_rollup() RPC + members → assembled tree. */
export async function getGoalsTree(now: number): Promise<GoalNode[]> {
  const supabase = await createClient();
  const [{ data: goals }, { data: aggs }, owners] = await Promise.all([
    supabase
      .from("goals")
      .select(
        "id, parent_goal_id, name, description, owner_id, workspace_id, progress_mode, status, start_value, current_value, target_value, unit, percent, start_date, due_date, position",
      )
      .order("position"),
    supabase.rpc("goals_rollup"),
    getGoalOwners(),
  ]);

  const rows: GoalRow[] = (goals ?? []).map((g) => toGoalRow(g as GoalDbRow));
  const boardAggs: BoardAgg[] = (aggs ?? []).map((a) => ({
    goalId: a.goal_id,
    boardId: a.board_id,
    total: Number(a.total_items),
    done: Number(a.done_items),
  }));
  return buildGoalTree(rows, boardAggs, owners, serverToday(now));
}
