import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getUserOrgs } from "@/lib/auth/session";
import { listOrgMembers } from "@/lib/boards/queries";
import { buildWorkloadGrid, serverToday } from "@/lib/workload/rollup";
import { EFFORT_FALLBACK } from "@/lib/workload/types";
import type {
  MemberCapacity,
  OrgWorkloadDefaults,
  WorkloadGrid,
  WorkloadMember,
  WorkloadRawRow,
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
 * Page-level data fetch. Owns the server clock so `Date.now()` never runs in the
 * RSC render body (the project's react-hooks rule forbids impure calls during
 * render). The loaded horizon (Q2) is today − 2 weeks … today + 10 weeks
 * (≈12 weeks) so the visible 6-week window can pan client-side with 0 refetch;
 * a from/to override only arrives when paging BEYOND the horizon (genuine RSC nav).
 */
export async function getWorkloadPageData(override?: {
  from?: string;
  to?: string;
}): Promise<{
  grid: WorkloadGrid;
  capacities: MemberCapacity[];
  defaults: OrgWorkloadDefaults;
}> {
  const now = Date.now();
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const from = override?.from ?? iso(now - 14 * DAY);
  const to = override?.to ?? iso(now + 70 * DAY);
  const { grid, capacities, defaults } = await getWorkloadGrid(
    from,
    to,
    now,
    1,
    4,
    1,
  );
  return { grid, capacities, defaults };
}
