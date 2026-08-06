import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { UserOrg } from "@/lib/auth/session";

/**
 * The org an MCP tool acts in. Mirrors `pickActiveOrg` with ONE deliberate
 * difference: an explicitly requested id that is not a membership returns null
 * instead of falling back to the first org. A stale cookie is a UX detail; an
 * agent passing the wrong `orgId` must be told, not silently served another
 * tenant's view. RLS remains the actual boundary underneath either way.
 */
export function resolveToolOrg(
  orgs: UserOrg[],
  requested?: string,
): UserOrg | null {
  if (requested) return orgs.find((o) => o.id === requested) ?? null;
  return orgs[0] ?? null;
}

/** The connected user's orgs, read through the bridged RLS client. */
export async function listToolOrgs(
  supabase: SupabaseClient<Database>,
): Promise<UserOrg[]> {
  const { data, error } = await supabase
    .from("organizations")
    .select("id, name, timezone")
    .order("name", { ascending: true });
  if (error) throw new Error(`Failed to load organizations: ${error.message}`);
  return data ?? [];
}

export type OrgMemberProfile = {
  userId: string;
  fullName: string | null;
  avatarUrl: string | null;
};

/** Hot-path cap. `org_members` PK is (org_id, user_id) — index-covered. */
export const ORG_MEMBER_PROFILES_LIMIT = 500;

/**
 * Org member profiles over the BRIDGED client. Deliberately not
 * `listOrgMembersCached`: that helper runs on the service client, and keeping
 * MCP off the service client entirely (spec §3.2) is worth one small
 * RLS-scoped query.
 *
 * Two queries, not a nested `org_members(...profiles(...))` select:
 * `org_members.user_id` references `auth.users`, not `public.profiles` — there
 * is no declared FK between them, so PostgREST can't embed the join and the
 * generated `Database` types have no `Relationships` entry to type it against.
 * `src/lib/org/queries-cached.ts` hits the same wall and does the same
 * two-query join.
 */
export async function listOrgMemberProfiles(
  supabase: SupabaseClient<Database>,
  orgId: string,
): Promise<OrgMemberProfile[]> {
  const { data: members, error: membersErr } = await supabase
    .from("org_members")
    .select("user_id")
    .eq("org_id", orgId)
    .is("deactivated_at", null)
    .limit(ORG_MEMBER_PROFILES_LIMIT);
  if (membersErr)
    throw new Error(`Failed to load org members: ${membersErr.message}`);

  const userIds = (members ?? []).map((m) => m.user_id);
  if (userIds.length === 0) return [];

  const { data: profiles, error: profilesErr } = await supabase
    .from("profiles")
    .select("id, full_name, avatar_url")
    .in("id", userIds);
  if (profilesErr)
    throw new Error(`Failed to load org members: ${profilesErr.message}`);

  const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));
  return userIds.map((userId) => {
    const profile = profileMap.get(userId) ?? null;
    return {
      userId,
      fullName: profile?.full_name ?? null,
      avatarUrl: profile?.avatar_url ?? null,
    };
  });
}

/** Load + resolve in one step. Returns a message every org-scoped tool surfaces verbatim. */
export async function resolveOrgForTool(
  supabase: SupabaseClient<Database>,
  requested?: string,
): Promise<{ org: UserOrg } | { error: string }> {
  const orgs = await listToolOrgs(supabase);
  const org = resolveToolOrg(orgs, requested);
  if (!org)
    return {
      error: requested
        ? `You are not a member of organization ${requested}.`
        : "No organization.",
    };
  return { org };
}
