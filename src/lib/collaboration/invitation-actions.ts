"use server";

import { updateTag } from "next/cache";
import { z } from "zod";
import { getUser } from "@/lib/auth/session";
import { invitationRedeemedTags } from "@/lib/cache/invitation-tags";
import { orgMembersTag } from "@/lib/cache/tags";
import { createClient } from "@/lib/supabase/server";

const OrgId = z.string().uuid();

/**
 * Called after the browser accepted an invitation (`accept_invitation` runs
 * from the client with the user's own session, so the server cache never saw
 * it). Expires the accepting user's cached "Shared with me", folder access and
 * role entries so a folder they were just invited to shows up on the next
 * navigation instead of after the nav cache window. The user is the session
 * user, never an argument; `orgId` only narrows the role tag and is validated.
 *
 * Joining also changed that org's member list, so its members tag is expired
 * too (else the newcomer shows as "Unknown member") — but only once a read on
 * the user's own session confirms they are an active member of `orgId`, so a
 * caller cannot expire an arbitrary org's cache.
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
  if (!parsed.success) return;
  const supabase = await createClient();
  const { data: membership } = await supabase
    .from("org_members")
    .select("org_id")
    .eq("org_id", parsed.data)
    .eq("user_id", user.id)
    .is("deactivated_at", null)
    .maybeSingle();
  if (membership) updateTag(orgMembersTag(parsed.data));
}
