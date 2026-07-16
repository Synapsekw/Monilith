"use server";
import { cookies } from "next/headers";
import { getUserOrgs } from "@/lib/auth/session";
import { ACTIVE_ORG_COOKIE } from "./active";

/**
 * Switch the active organization. Sets the cookie only — the caller triggers a
 * `router.refresh()` so the streamed shell re-renders scoped to the new org.
 * No revalidateTag: org caches (dashboards/workspaces/…) are keyed by org id, so
 * a switch simply hits a different cache entry. Membership is re-verified here as
 * defense-in-depth (reads also re-verify via resolveActiveOrg).
 */
export async function setActiveOrg(orgId: string): Promise<void> {
  const orgs = await getUserOrgs();
  if (!orgs.some((o) => o.id === orgId)) return;
  const jar = await cookies();
  jar.set(ACTIVE_ORG_COOKIE, orgId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}
