import "server-only";
import { getFolderAccessForUserCached } from "@/lib/folders/access-cached";
import { getActiveOrgId } from "@/lib/org/active";

/**
 * Whether the signed-in user is a guest of the ACTIVE org. Reads the same
 * cached entry the sidebar and the command palette already load for the shell
 * (`getFolderAccessForUserCached`, keyed by user and org), so a page asking
 * this adds no query. `userId` comes from the session, read outside the cache.
 *
 * Presentation only: it decides which controls and empty states render. RLS
 * and the guest triggers remain the boundary. With no active org the answer is
 * false (there is nothing to be a guest of; the page's own no-org path runs).
 */
export async function isActiveOrgGuest(userId: string): Promise<boolean> {
  const orgId = await getActiveOrgId();
  if (!orgId) return false;
  return (await getFolderAccessForUserCached(userId, orgId)).isGuest;
}
