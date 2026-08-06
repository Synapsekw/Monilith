import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { createClient } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth/session";
import { getActiveOrgId } from "@/lib/org/active";
import { listOrgMembersCached } from "@/lib/org/queries-cached";
import { listReadableBoardsCached } from "@/lib/portfolios/queries-cached";
import { serverToday, isoWeekday } from "@/lib/workload/rollup";
import { EFFORT_FALLBACK } from "@/lib/workload/types";
import type { OrgMemberProfile } from "@/lib/mcp/org-scope";
import type {
  MemberCapacity,
  OrgWorkloadDefaults,
  WorkloadActualRow,
  WorkloadBoard,
  WorkloadMember,
  WorkloadPageData,
  WorkloadRawRow,
  WorkloadWorkspace,
} from "@/lib/workload/types";

async function listOrgMembersForWorkload(
  orgId: string,
): Promise<WorkloadMember[]> {
  const members = await listOrgMembersCached(orgId); // { userId, fullName, email, avatarUrl }[]
  return members.map((m) => ({
    userId: m.userId,
    fullName: m.fullName,
    email: m.email,
    avatarUrl: m.avatarUrl,
  }));
}

async function getMemberCapacities(orgId: string): Promise<MemberCapacity[]> {
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

async function getWorkloadDefaults(
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

const DAY = 86_400_000;

/**
 * Bounded read of completed logged time per (assignee, board, day) over the
 * horizon, for the actuals overlay (v2). Folded into week buckets client-side.
 * Backed by the `workload_actuals_rollup` RPC (migration 20260622170000):
 * is_org_member + can_read_board gated, completed entries only, LIMIT 5000.
 */
async function getWorkloadActuals(
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

  // Identity reads OUTSIDE the cache scopes (9.3 rule): userId keys the cached
  // readable-boards entry, orgId keys the cached members entry.
  const [user, orgId] = await Promise.all([getUser(), getActiveOrgId()]);
  const userId = user?.id ?? "";
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
    // listReadableBoardsCached("") returns [] via the no-membership guard —
    // same failure shape as the previous RLS empty read.
    listReadableBoardsCached(userId),
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

export type WorkloadSummaryRow = {
  userId: string;
  name: string | null;
  allocatedSecs: number;
  itemCount: number;
  capacitySecs: number;
};

/**
 * Per-member planned load over a window, for the MCP surface.
 *
 * Deliberately NOT an extraction of `getWorkloadPageData`: that ships raw rows
 * plus board/workspace metadata so the grid recomputes client-side with zero
 * round-trips (AGENTS.md §5) — the right shape for a UI, the wrong shape for an
 * agent. This folds the same `workload_rollup` RPC into one row per member.
 *
 * Capacity uses the member's own row when present, else the org default, else
 * EFFORT_FALLBACK — the same precedence the page applies.
 */
export async function getWorkloadSummaryCore(
  supabase: SupabaseClient<Database>,
  args: {
    orgId: string;
    from: string;
    to: string;
    members: OrgMemberProfile[];
  },
): Promise<WorkloadSummaryRow[]> {
  const [rollupRes, capacityRes, defaultsRes] = await Promise.all([
    supabase.rpc("workload_rollup", { p_from: args.from, p_to: args.to }),
    supabase
      .from("member_capacity")
      .select("user_id, hours_per_day, working_days")
      .eq("org_id", args.orgId),
    supabase
      .from("org_workload_settings")
      .select("default_hours_per_day, default_working_days")
      .eq("org_id", args.orgId)
      .maybeSingle(),
  ]);

  const defaultHours = Number(
    defaultsRes.data?.default_hours_per_day ?? EFFORT_FALLBACK.hoursPerDay,
  );
  const defaultDays = (
    defaultsRes.data?.default_working_days ?? EFFORT_FALLBACK.workingDays
  ).map(Number);

  const capacity = new Map<
    string,
    { hoursPerDay: number; workingDays: number[] }
  >();
  for (const c of capacityRes.data ?? [])
    capacity.set(c.user_id, {
      hoursPerDay: Number(c.hours_per_day),
      workingDays: (c.working_days ?? []).map(Number),
    });

  const workingDaysInWindow = countWorkingDays(args.from, args.to, defaultDays);

  const totals = new Map<string, { secs: number; items: number }>();
  for (const r of rollupRes.data ?? []) {
    if (!r.user_id) continue;
    const t = totals.get(r.user_id) ?? { secs: 0, items: 0 };
    t.secs += r.estimate_secs == null ? 0 : Number(r.estimate_secs);
    t.items += 1;
    totals.set(r.user_id, t);
  }

  return args.members.map((m) => {
    const t = totals.get(m.userId) ?? { secs: 0, items: 0 };
    const cap = capacity.get(m.userId);
    const hoursPerDay = cap?.hoursPerDay ?? defaultHours;
    const days = cap
      ? countWorkingDays(args.from, args.to, cap.workingDays)
      : workingDaysInWindow;
    return {
      userId: m.userId,
      name: m.fullName,
      allocatedSecs: t.secs,
      itemCount: t.items,
      capacitySecs: Math.round(hoursPerDay * 3600 * days),
    };
  });
}

/**
 * Working days in `[from, to]` (inclusive) whose stored weekday — ISO
 * convention 1=Mon … 7=Sun, per `EFFORT_FALLBACK.workingDays` in
 * `./types.ts` — is in `workingDays`. Delegates the day-of-week conversion to
 * `isoWeekday` (`./rollup.ts`) rather than re-deriving it, so this can't drift
 * from the convention the rest of the workload feature already uses.
 */
function countWorkingDays(
  from: string,
  to: string,
  workingDays: number[],
): number {
  const allowed = new Set(workingDays);
  let count = 0;
  for (
    let t = Date.parse(`${from}T00:00:00Z`);
    t <= Date.parse(`${to}T00:00:00Z`);
    t += DAY
  ) {
    const iso = new Date(t).toISOString().slice(0, 10);
    if (allowed.has(isoWeekday(iso))) count++;
  }
  return count;
}
