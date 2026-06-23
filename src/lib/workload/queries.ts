import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getUserOrgs } from "@/lib/auth/session";
import { listOrgMembers } from "@/lib/boards/queries";
import { listReadableBoards } from "@/lib/portfolios/queries";
import { buildWorkloadGrid, serverToday } from "@/lib/workload/rollup";
import { EFFORT_FALLBACK } from "@/lib/workload/types";
import type {
  MemberCapacity,
  OrgWorkloadDefaults,
  WorkloadActualRow,
  WorkloadBoard,
  WorkloadGrid,
  WorkloadMember,
  WorkloadPageData,
  WorkloadRawRow,
  WorkloadWorkspace,
} from "@/lib/workload/types";

export async function listOrgMembersForWorkload(
  orgId: string,
): Promise<WorkloadMember[]> {
  const members = await listOrgMembers(orgId); // { userId, fullName, email, avatarUrl }[]
  return members.map((m) => ({
    userId: m.userId,
    fullName: m.fullName,
    email: m.email,
    avatarUrl: m.avatarUrl,
  }));
}

export async function getMemberCapacities(
  orgId: string,
): Promise<MemberCapacity[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("member_capacity")
    .select("user_id, hours_per_day, working_days")
    .eq("org_id", orgId);
  return (data ?? []).map((r) => ({
    userId: r.user_id,
    hoursPerDay: Number(r.hours_per_day),
    workingDays: (r.working_days ?? []).map(Number),
    customized: true,
  }));
}

export async function getWorkloadDefaults(
  orgId: string,
): Promise<OrgWorkloadDefaults> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("org_workload_settings")
    .select(
      "default_hours_per_day, default_per_item_hours, default_working_days",
    )
    .eq("org_id", orgId)
    .maybeSingle();
  if (!data) {
    return {
      hoursPerDay: EFFORT_FALLBACK.hoursPerDay,
      perItemHours: EFFORT_FALLBACK.perItemHours,
      workingDays: [...EFFORT_FALLBACK.workingDays],
    };
  }
  return {
    hoursPerDay: Number(data.default_hours_per_day),
    perItemHours: Number(data.default_per_item_hours),
    workingDays: (data.default_working_days ?? EFFORT_FALLBACK.workingDays).map(
      Number,
    ),
  };
}

/** One bounded pass: rollup RPC + members + capacities + defaults → assembled grid. */
export async function getWorkloadGrid(
  from: string,
  to: string,
  now: number,
  weeksBack = 1,
  weeksFwd = 4,
  weekStartsOn = 1,
): Promise<{
  grid: WorkloadGrid;
  orgId: string;
  capacities: MemberCapacity[];
  defaults: OrgWorkloadDefaults;
}> {
  const orgs = await getUserOrgs();
  const orgId = orgs[0]?.id ?? "";
  const supabase = await createClient();
  const [{ data: raw }, members, caps, defaults] = await Promise.all([
    supabase.rpc("workload_rollup", { p_from: from, p_to: to }),
    listOrgMembersForWorkload(orgId),
    getMemberCapacities(orgId),
    getWorkloadDefaults(orgId),
  ]);

  const rows: WorkloadRawRow[] = (raw ?? []).map((r) => ({
    itemId: r.item_id,
    boardId: r.board_id,
    itemName: r.item_name,
    userId: r.user_id,
    startDate: r.start_date,
    endDate: r.end_date,
    estimateSecs: r.estimate_secs == null ? null : Number(r.estimate_secs),
  }));

  const grid = buildWorkloadGrid(
    rows,
    members,
    caps,
    defaults,
    serverToday(now),
    weeksBack,
    weeksFwd,
    weekStartsOn,
  );
  return { grid, orgId, capacities: caps, defaults };
}

const DAY = 86_400_000;

/**
 * Bounded read of completed logged time per (assignee, board, day) over the
 * horizon, for the actuals overlay (v2). Folded into week buckets client-side.
 * Backed by the `workload_actuals_rollup` RPC (migration 20260622170000):
 * is_org_member + can_read_board gated, completed entries only, LIMIT 5000.
 */
export async function getWorkloadActuals(
  from: string,
  to: string,
): Promise<WorkloadActualRow[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("workload_actuals_rollup", {
    p_from: from,
    p_to: to,
  });
  return (data ?? []).map((r) => ({
    userId: r.user_id,
    boardId: r.board_id,
    day: r.day,
    secs: Number(r.secs),
  }));
}

/**
 * Page-level data fetch (v2). Ships RAW rows + board/workspace metadata + the
 * server clock so workspace/board filtering and the planned/actual metric toggle
 * recompute the grid CLIENT-SIDE with 0 round-trips (AGENTS.md §5). The loaded
 * horizon is today − 2 weeks … today + 10 weeks (≈12 weeks) so the visible window
 * pans client-side; a from/to override only arrives when paging BEYOND it.
 */
export async function getWorkloadPageData(override?: {
  from?: string;
  to?: string;
}): Promise<WorkloadPageData> {
  const now = Date.now();
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const from = override?.from ?? iso(now - 14 * DAY);
  const to = override?.to ?? iso(now + 70 * DAY);
  const weeksBack = 1;
  const weeksFwd = 4;
  const weekStartsOn = 1;

  const orgs = await getUserOrgs();
  const orgId = orgs[0]?.id ?? "";
  const supabase = await createClient();

  const [
    { data: raw },
    actuals,
    members,
    capacities,
    defaults,
    boards,
    { data: wsRows },
  ] = await Promise.all([
    supabase.rpc("workload_rollup", { p_from: from, p_to: to }),
    getWorkloadActuals(from, to),
    listOrgMembersForWorkload(orgId),
    getMemberCapacities(orgId),
    getWorkloadDefaults(orgId),
    listReadableBoards(),
    supabase
      .from("workspaces")
      .select("id, name")
      .order("name", { ascending: true }),
  ]);

  const rawRows: WorkloadRawRow[] = (raw ?? []).map((r) => ({
    itemId: r.item_id,
    boardId: r.board_id,
    itemName: r.item_name,
    userId: r.user_id,
    startDate: r.start_date,
    endDate: r.end_date,
    estimateSecs: r.estimate_secs == null ? null : Number(r.estimate_secs),
  }));

  const workspaces: WorkloadWorkspace[] = (wsRows ?? []).map((w) => ({
    id: w.id,
    name: w.name,
  }));

  return {
    rawRows,
    actuals,
    members,
    capacities,
    defaults,
    boards: boards as WorkloadBoard[],
    workspaces,
    today: serverToday(now),
    weeksBack,
    weeksFwd,
    weekStartsOn,
  };
}
