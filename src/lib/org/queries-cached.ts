import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { createServiceClient } from "@/lib/supabase/service";
import { orgMembersTag } from "@/lib/cache/tags";
import type { OrgMember } from "@/lib/boards/queries";

/** Hot-path cap (AGENTS.md: bounded reads). org_members' PK is (org_id, user_id),
 * so the filter is index-covered. Truncates silently at the cap. */
export const ORG_MEMBERS_LIMIT = 500;

/**
 * Cached org member list (people pickers, owner maps, workload rows).
 *
 * WHOLE ORG, SHARED BY EVERY VIEWER. Do not hand this to a page, picker or
 * prompt: a guest may see only the people they share access with. Read it
 * through `@/lib/org/visible-roster`, which narrows it per viewer.
 *
 * `orgId`
 * is part of the cache key AND the tag; the explicit `org_id = orgId` filter is
 * the tenant boundary (the service client bypasses RLS). CALLER CONTRACT: pass
 * an orgId the current user is entitled to (their getUserOrgs() org, or the
 * org_id of a board/portfolio row they can read) — same contract as
 * `listDashboardsCached`.
 *
 * Matches the previous RLS-scoped `listOrgMembers` behavior 1:1 (two-query
 * profiles join, deactivated rows included) so migrating callers is not a
 * behavior change.
 *
 * Invalidation: remove/deactivate/reactivateMember update `orgMembersTag`.
 * Invite redemption (`redeem_invitations` returns only a count) and future
 * profile display edits are TTL-covered by cacheLife("nav") (≤60 s stale) —
 * any future full_name/avatar edit action MUST updateTag(orgMembersTag(orgId))
 * for each of the user's orgs. `isGuest` is derived from the role, so
 * setMemberRole is in the invalidation set too.
 */
export async function listOrgMembersCached(
  orgId: string,
): Promise<OrgMember[]> {
  "use cache";
  cacheLife("nav");
  cacheTag(orgMembersTag(orgId));

  const supabase = createServiceClient();
  const { data: members, error: membersErr } = await supabase
    .from("org_members")
    .select("user_id, role")
    .eq("org_id", orgId)
    // A Mono is an org member with role `agent`, never a person in a roster.
    .neq("role", "agent")
    .limit(ORG_MEMBERS_LIMIT);
  if (membersErr || !members || members.length === 0) return [];

  const userIds = members.map((m) => m.user_id);
  const guestIds = new Set(
    members.filter((m) => m.role === "guest").map((m) => m.user_id),
  );
  // Two-query JS join: org_members → profiles has no declared FK (user_id
  // references auth.users), so the nested PostgREST embed does not typecheck.
  const { data: profiles, error: profilesErr } = await supabase
    .from("profiles")
    .select("id, full_name, email, avatar_url")
    .in("id", userIds);
  if (profilesErr || !profiles) return [];

  const profileMap = new Map(profiles.map((p) => [p.id, p]));
  return userIds.map((userId) => {
    const profile = profileMap.get(userId) ?? null;
    return {
      userId,
      fullName: profile?.full_name ?? null,
      email: profile?.email ?? null,
      avatarUrl: profile?.avatar_url ?? null,
      ...(guestIds.has(userId) ? { isGuest: true } : {}),
    };
  });
}
