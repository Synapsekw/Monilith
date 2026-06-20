import { cache } from "react";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/types/database.types";

export type Organization = Tables<"organizations">;

/**
 * Returns the authenticated Supabase user, or null when unauthenticated.
 * Wrapped in React `cache()` so the layout and page in one request share a
 * single `auth.getUser()` round-trip instead of two.
 */
export const getUser = cache(async (): Promise<User | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

/** Redirect a flagged user to the forced password-change screen.
 * The flag is set by the platform admin via app_metadata.must_change_password. */
export function enforcePasswordChange(user: User): void {
  if (user.app_metadata?.must_change_password === true) {
    redirect("/change-password");
  }
}

/** Returns the authenticated user, redirecting to /login when absent. */
export async function requireUser(): Promise<User> {
  const user = await getUser();
  // redirect() throws — keep it outside any try/catch.
  if (!user) redirect("/login");
  enforcePasswordChange(user);
  return user;
}

/** Returns the organizations the current user belongs to (RLS-scoped). */
export async function getUserOrgs(): Promise<Organization[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("organizations").select("*");
  if (error) return [];
  return data ?? [];
}
