import { cache } from "react";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/types/database.types";

export type Organization = Tables<"organizations">;

/**
 * The subset of an organization the app actually reads off `getUserOrgs()`:
 * every caller uses only `id` (org scoping), `name` (welcome/settings headers),
 * or `timezone` (settings org card). Narrowing the select to these three keeps
 * the hot per-page read off `select("*")`.
 */
export type UserOrg = Pick<Organization, "id" | "name" | "timezone">;

/**
 * The session identity derived from the verified access-token claims — the
 * subset of Supabase's `User` carried in the JWT. Everything the app reads off
 * the session (id, email, the two metadata bags) lives here; no consumer needs
 * the server-only `User` fields (created_at, identities, …).
 */
export type SessionUser = Pick<
  User,
  "id" | "email" | "user_metadata" | "app_metadata"
>;

/**
 * Returns the authenticated user derived from the access-token claims, or null
 * when unauthenticated.
 *
 * Uses `getClaims()`, NOT `getUser()`: this project has asymmetric (ES256) JWT
 * signing keys enabled, so the token is verified **locally** against the cached
 * JWKS — no per-request round-trip to the Supabase auth server (which
 * `getUser()` made on every call). Token *refresh* still happens once per
 * request in `proxy.ts` (which keeps `getUser()` precisely because it refreshes
 * expiring sessions); by the time an RSC renders, the cookie is fresh, so a
 * local verify here is both correct and ~1 network round-trip cheaper per page.
 *
 * Wrapped in React `cache()` so the layout and page in one request share a
 * single verification.
 */
export const getUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data) return null;
  const { claims } = data;
  return {
    id: claims.sub,
    email: claims.email,
    user_metadata: claims.user_metadata ?? {},
    app_metadata: claims.app_metadata ?? {},
  };
});

/** Redirect a flagged user to the forced password-change screen.
 * The flag is set by the platform admin via app_metadata.must_change_password. */
export function enforcePasswordChange(user: SessionUser): void {
  if (user.app_metadata?.must_change_password === true) {
    redirect("/change-password");
  }
}

/** Returns the authenticated user, redirecting to /login when absent. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getUser();
  // redirect() throws — keep it outside any try/catch.
  if (!user) redirect("/login");
  enforcePasswordChange(user);
  return user;
}

/**
 * Returns the organizations the current user belongs to (RLS-scoped).
 *
 * Wrapped in React `cache()` (like `getUser`) so the 2–4 callers that run in one
 * authenticated render (sidebar + command palette + page + guards) share a
 * single query instead of re-hitting `organizations` each time. The select is
 * narrowed to the fields every caller reads (see `UserOrg`).
 *
 * A DB failure THROWS instead of returning [] — silent [] was indistinguishable
 * from "no org yet", so /home and /onboarding misrouted fully-provisioned users
 * into onboarding on a transient DB error. Same policy as getBoardPayload:
 * a DB failure is not a 404; let the error boundary render.
 */
export const getUserOrgs = cache(async (): Promise<UserOrg[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organizations")
    .select("id, name, timezone");
  if (error) throw new Error(`Failed to load organizations: ${error.message}`);
  return data ?? [];
});
