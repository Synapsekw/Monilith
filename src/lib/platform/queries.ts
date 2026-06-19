import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { isPlatformAdmin } from "./guard";

export type PlatformOrg = {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  member_count: number;
};

export type PlatformStats = {
  orgs: number;
  users: number;
  admins: number;
  events24h: number;
};

const ZERO_STATS: PlatformStats = {
  orgs: 0,
  users: 0,
  admins: 0,
  events24h: 0,
};

export async function getPlatformStats(): Promise<PlatformStats> {
  if (!(await isPlatformAdmin())) return ZERO_STATS;
  const { data } = await createServiceClient().rpc("platform_stats");
  const row = data?.[0];
  if (!row) return ZERO_STATS;
  return {
    orgs: Number(row.orgs),
    users: Number(row.users),
    admins: Number(row.admins),
    events24h: Number(row.events_24h),
  };
}

function shapeOrg(r: {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  org_members: { count: number }[];
}): PlatformOrg {
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    created_at: r.created_at,
    member_count: r.org_members?.[0]?.count ?? 0,
  };
}

/** Recent orgs for the overview (bounded). */
export async function listAllOrgs(
  page = 0,
  pageSize = 50,
): Promise<PlatformOrg[]> {
  if (!(await isPlatformAdmin())) return [];
  const from = page * pageSize;
  const { data } = await createServiceClient()
    .from("organizations")
    .select("id, name, slug, created_at, org_members(count)")
    .order("created_at", { ascending: false })
    .range(from, from + pageSize - 1);
  return (data ?? []).map((r) => shapeOrg(r as Parameters<typeof shapeOrg>[0]));
}

/** Paginated + optionally filtered org list with total count, for the orgs page. */
export async function listOrgsPage(
  page = 0,
  pageSize = 25,
  query = "",
): Promise<{ rows: PlatformOrg[]; total: number }> {
  if (!(await isPlatformAdmin())) return { rows: [], total: 0 };
  const from = page * pageSize;
  let q = createServiceClient()
    .from("organizations")
    .select("id, name, slug, created_at, org_members(count)", {
      count: "exact",
    })
    .order("created_at", { ascending: false })
    .range(from, from + pageSize - 1);
  const trimmed = query.trim();
  if (trimmed) q = q.or(`name.ilike.%${trimmed}%,slug.ilike.%${trimmed}%`);
  const { data, count } = await q;
  return {
    rows: (data ?? []).map((r) =>
      shapeOrg(r as Parameters<typeof shapeOrg>[0]),
    ),
    total: count ?? 0,
  };
}

export type PlatformAuditRow = {
  id: string;
  org_id: string | null;
  actor_id: string;
  actor_kind: string;
  action: string;
  target_email: string | null;
  created_at: string;
};

export async function platformAuditFeed(
  limit = 50,
  offset = 0,
): Promise<PlatformAuditRow[]> {
  if (!(await isPlatformAdmin())) return [];
  const { data } = await createServiceClient()
    .from("admin_audit_log")
    .select(
      "id, org_id, actor_id, actor_kind, action, target_email, created_at",
    )
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  return (data as PlatformAuditRow[] | null) ?? [];
}

export type PlatformUser = {
  id: string;
  email: string | null;
  bannedUntil: string | null;
  orgNames: string[];
};

/** Filtered user search via the SECURITY DEFINER RPC (no in-memory cap). */
export async function searchUsers(
  query = "",
  limit = 25,
  offset = 0,
): Promise<PlatformUser[]> {
  if (!(await isPlatformAdmin())) return [];
  const { data } = await createServiceClient().rpc("platform_search_users", {
    p_query: query.trim(),
    p_limit: limit,
    p_offset: offset,
  });
  return (data ?? []).map((u) => ({
    id: u.id,
    email: u.email,
    bannedUntil: u.banned_until,
    orgNames: u.org_names ?? [],
  }));
}
