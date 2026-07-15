import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { getUserOrgs, type UserOrg } from "@/lib/auth/session";

/** Persisted "current organization" selection. UX only — RLS + getUserOrgs()
 * remain the security boundary; the cookie is re-validated on every read. */
export const ACTIVE_ORG_COOKIE = "pulse_active_org";

/**
 * The active org: the cookie value when it still matches one of the user's
 * orgs, otherwise the first org (stable default), otherwise null. Validating
 * against the list means a deleted/foreign id can never scope the app to a
 * tenant the user doesn't belong to. Mirrors getActiveWorkspaceId.
 */
export function pickActiveOrg(
  orgs: UserOrg[],
  cookieValue: string | undefined,
): UserOrg | null {
  if (cookieValue) {
    const match = orgs.find((o) => o.id === cookieValue);
    if (match) return match;
  }
  return orgs[0] ?? null;
}

/**
 * Resolve the active org for the current request. React cache()-wrapped so the
 * sidebar, command palette, page, and guards in one render share one resolve.
 * getUserOrgs() is RLS-scoped (== membership verified) and throws on DB error;
 * we let that propagate (a transient error is not "no org").
 */
export const resolveActiveOrg = cache(async (): Promise<UserOrg | null> => {
  const orgs = await getUserOrgs();
  const raw = (await cookies()).get(ACTIVE_ORG_COOKIE)?.value;
  return pickActiveOrg(orgs, raw);
});

/** Convenience: the active org id, or "" when the user has no org. */
export async function getActiveOrgId(): Promise<string> {
  return (await resolveActiveOrg())?.id ?? "";
}
