import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getUser, getUserOrgs } from "@/lib/auth/session";

/**
 * True if the current authenticated user is an owner/admin of their org.
 * Fails closed. Mirrors `isPlatformAdmin()` and the role check in settings.
 */
export const isOrgAdmin = cache(async (): Promise<boolean> => {
  const [user, orgs] = await Promise.all([getUser(), getUserOrgs()]);
  const orgId = orgs[0]?.id;
  if (!user || !orgId) return false;

  const supabase = await createClient();
  const { data: members, error } = await supabase.rpc("get_org_members", {
    p_org_id: orgId,
  });
  if (error) return false;
  const me = (members ?? []).find((m) => m.user_id === user.id);
  return me?.role === "owner" || me?.role === "admin";
});
