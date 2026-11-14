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
    .neq("role", "agent")
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

/**
 * The org for a tool call scoped to a board or a project folder (review I2).
 *
 * Without an `orgId`, `resolveOrgForTool` picks the caller's alphabetically
 * first org, so a board or folder in any other org would be filtered to an
 * empty result that reads exactly like "no match". When the call names a board
 * or folder and no org, the org is read from that row through the caller's own
 * RLS-scoped client: a row the caller cannot read comes back as "not found",
 * never as another org's answer. An explicit `orgId` still wins (and is still
 * checked for membership). A read failure throws, so the handler's catch
 * surfaces it instead of turning an outage into "not found".
 */
export async function resolveOrgForScope(
  supabase: SupabaseClient<Database>,
  scope: { orgId?: string; boardId?: string; folderId?: string },
): Promise<{ org: UserOrg } | { error: string }> {
  if (scope.orgId || (!scope.boardId && !scope.folderId))
    return resolveOrgForTool(supabase, scope.orgId);

  let orgId: string | undefined;
  if (scope.boardId) {
    const { data, error } = await supabase
      .from("boards")
      .select("org_id")
      .eq("id", scope.boardId)
      .maybeSingle();
    if (error) throw new Error(`Failed to load board: ${error.message}`);
    if (!data) return { error: "Board not found." };
    orgId = data.org_id;
  } else if (scope.folderId) {
    const { data, error } = await supabase
      .from("folders")
      .select("org_id")
      .eq("id", scope.folderId)
      .maybeSingle();
    if (error) throw new Error(`Failed to load folder: ${error.message}`);
    if (!data) return { error: "Folder not found." };
    orgId = data.org_id;
  }
  return resolveOrgForTool(supabase, orgId);
}
