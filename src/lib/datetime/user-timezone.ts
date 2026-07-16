import "server-only";

import { getUserTimeZoneCached } from "@/lib/profile/queries-cached";
import { resolveActiveOrg } from "@/lib/org/active";

/**
 * The effective IANA timezone used to bucket a user's time entries into local
 * calendar days. Resolution order, most-specific first:
 *   1. the user's personal display timezone (`profiles.timezone`);
 *   2. their organization's timezone (`organizations.timezone`, always set);
 *   3. `"UTC"` as a last resort.
 *
 * Server-only: no device zone is available here, so `null` ("Automatic") falls
 * back to the org zone rather than the viewer's browser zone. This single
 * resolver is shared by the read path (the /time card bucketing) and the write
 * path (manual-entry midday anchoring) so a day written as "Monday" is read back
 * as Monday for the same user.
 */
export async function resolveUserTimeZone(userId: string): Promise<string> {
  const [profileTz, activeOrg] = await Promise.all([
    getUserTimeZoneCached(userId),
    resolveActiveOrg(),
  ]);
  return profileTz ?? activeOrg?.timezone ?? "UTC";
}
