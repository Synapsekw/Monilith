"use server";

import { updateTag } from "next/cache";
import { z } from "zod";
import { getUser } from "@/lib/auth/session";
import { invitationRedeemedTags } from "@/lib/cache/invitation-tags";

const OrgId = z.string().uuid();

/**
 * Called after the browser accepted an invitation (`accept_invitation` runs
 * from the client with the user's own session, so the server cache never saw
 * it). Expires the accepting user's cached "Shared with me", folder access and
 * role entries so a folder they were just invited to shows up on the next
 * navigation instead of after the nav cache window. The user is the session
 * user, never an argument; `orgId` only narrows the role tag and is validated.
 */
export async function refreshAccessAfterInvitation(
  orgId?: string,
): Promise<void> {
  const user = await getUser();
  if (!user) return;
  const parsed = OrgId.safeParse(orgId);
  for (const tag of invitationRedeemedTags(
    user.id,
    parsed.success ? parsed.data : undefined,
  )) {
    updateTag(tag);
  }
}
