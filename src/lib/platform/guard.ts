import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { enforcePasswordChange } from "@/lib/auth/session";

/** True if the current authenticated user is a platform super-admin. Fails closed. */
export const isPlatformAdmin = cache(async (): Promise<boolean> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("is_platform_admin");
  if (error) return false;
  return data === true;
});

/** Gate a platform route. Redirects (never reveals /admin) for non-admins. */
export async function requirePlatformAdmin(): Promise<User> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  enforcePasswordChange(user);
  if (!(await isPlatformAdmin())) redirect("/");
  return user;
}
