"use server";
import { cookies } from "next/headers";
import { ACTIVE_WS_COOKIE } from "./active";

/**
 * Switch the active workspace. Sets the cookie only — the caller triggers a
 * `router.refresh()` so the streamed sidebar re-renders with the newly scoped
 * board/dashboard lists (rule #5: a change of server-data scope, not an in-page
 * toggle). No revalidateTag: the cached reads are keyed by workspace id, so a
 * switch simply hits a different cache entry.
 */
export async function setActiveWorkspace(workspaceId: string): Promise<void> {
  const jar = await cookies();
  jar.set(ACTIVE_WS_COOKIE, workspaceId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}
