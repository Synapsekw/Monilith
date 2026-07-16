import "server-only";
import { cache } from "react";
import { cacheLife, cacheTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getUser } from "@/lib/auth/session";
import { getActiveOrgId } from "@/lib/org/active";
import { orgAdminTag } from "@/lib/cache/tags";

/**
 * True if the current authenticated user is an owner/admin of their org.
 * Fails closed. Mirrors `isPlatformAdmin()` and the role check in settings.
 */
export const isOrgAdmin = cache(async (): Promise<boolean> => {
  const [user, orgId] = await Promise.all([getUser(), getActiveOrgId()]);
  if (!user || !orgId) return false;

  const supabase = await createClient();
  const { data: members, error } = await supabase.rpc("get_org_members", {
    p_org_id: orgId,
  });
  if (error) return false;
  const me = (members ?? []).find((m) => m.user_id === user.id);
  return me?.role === "owner" || me?.role === "admin";
});

/**
 * Cached org-admin flag for the sidebar. `userId`+`orgId` are passed in (cache
 * key + tag); the explicit `org_id`/`user_id` filters on `org_members` are the
 * tenant boundary (the service client bypasses RLS). Mirrors the role check in
 * `isOrgAdmin` (owner|admin) but for an explicit identity rather than the
 * session. Fails closed.
 */
export async function isOrgAdminCached(
  userId: string,
  orgId: string,
): Promise<boolean> {
  "use cache";
  cacheLife("guard");
  cacheTag(orgAdminTag(userId, orgId));

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("org_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) return false;
  return data.role === "owner" || data.role === "admin";
}
