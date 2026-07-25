import "server-only";
import { cache } from "react";
import { cacheLife, cacheTag } from "next/cache";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { enforcePasswordChange, loginRedirectPath } from "@/lib/auth/session";
import { platformAdminTag } from "@/lib/cache/tags";

/** True if the current authenticated user is a platform super-admin. Fails closed. */
export const isPlatformAdmin = cache(async (): Promise<boolean> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("is_platform_admin");
  if (error) return false;
  return data === true;
});

/**
 * Cached platform-admin flag for SIDEBAR VISIBILITY only. `userId` is passed in
 * (cache key + tag); the explicit `user_id = userId` filter on `platform_admins`
 * is the tenant boundary (the service client bypasses RLS). NOTE: the uncached
 * `requirePlatformAdmin` keeps the live RLS check for sensitive /admin routes —
 * only the sidebar visibility flag is cached (9.1 decision). Fails closed.
 */
export async function isPlatformAdminCached(userId: string): Promise<boolean> {
  "use cache";
  cacheLife("guard");
  cacheTag(platformAdminTag(userId));

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return false;
  return data !== null;
}

/** Gate a platform route. Redirects (never reveals /admin) for non-admins. */
export async function requirePlatformAdmin(): Promise<User> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(await loginRedirectPath());
  enforcePasswordChange(user);
  if (!(await isPlatformAdmin())) redirect("/");
  return user;
}
