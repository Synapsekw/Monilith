import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { isPlatformAdmin } from "./guard";

export type PlatformOrg = {
  id: string;
  name: string;
  slug: string;
  created_at: string;
};

export async function listAllOrgs(
  page = 0,
  pageSize = 50,
): Promise<PlatformOrg[]> {
  if (!(await isPlatformAdmin())) return [];
  const from = page * pageSize;
  const { data } = await createServiceClient()
    .from("organizations")
    .select("id, name, slug, created_at")
    .order("created_at", { ascending: false })
    .range(from, from + pageSize - 1);
  return (data as PlatformOrg[] | null) ?? [];
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
): Promise<PlatformAuditRow[]> {
  if (!(await isPlatformAdmin())) return [];
  const { data } = await createServiceClient()
    .from("admin_audit_log")
    .select(
      "id, org_id, actor_id, actor_kind, action, target_email, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data as PlatformAuditRow[] | null) ?? [];
}

export type PlatformUser = { id: string; email: string | null };

/** Substring search across users (paginated admin listing). */
export async function searchUsers(
  query: string,
  limit = 20,
): Promise<PlatformUser[]> {
  if (!(await isPlatformAdmin())) return [];
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const { data } = await createServiceClient().auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });
  return (data?.users ?? [])
    .filter((u) => (u.email ?? "").toLowerCase().includes(q))
    .slice(0, limit)
    .map((u) => ({ id: u.id, email: u.email ?? null }));
}
