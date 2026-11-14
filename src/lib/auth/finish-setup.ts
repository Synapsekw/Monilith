import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidateTag } from "next/cache";
import { invitationRedeemedTags } from "@/lib/cache/invitation-tags";
import { orgMembersTag } from "@/lib/cache/tags";
import { createClient } from "@/lib/supabase/server";
import { provisionAccountForUser } from "@/lib/auth/provision";
import { redeemInvitationsForUser } from "@/lib/auth/redeem";
import type { SessionUser } from "@/lib/auth/session";
import type { Database } from "@/types/database.types";

export type FinishAccountSetupResult =
  { ok: true } | { ok: false; reason: "provisioning" };

/**
 * Expire the user's cached "Shared with me" / folder-access entries. This runs
 * from a Route Handler (the auth callback) and a Server Action (the waiting
 * screen), where `updateTag` is not available in the first and
 * `revalidateTag(tag, { expire: 0 })` is valid in both. It runs in the render
 * phase on /onboarding, where revalidation is not allowed and throws; a brand
 * new user has no cached entries yet, so that case is safely a no-op.
 */
function expireRedeemedAccess(userId: string): void {
  for (const tag of invitationRedeemedTags(userId)) {
    try {
      revalidateTag(tag, { expire: 0 });
    } catch {
      // Render phase: nothing cached to expire for a user still in setup.
    }
  }
}

/** Cap on the orgs read back after a redemption (a person joins a handful). */
const JOINED_ORGS_LIMIT = 50;

/**
 * A redemption that created org memberships changed those orgs' member lists:
 * expire them, so the person who just joined does not show as "Unknown
 * member" to everyone else until the cache window passes. The joined orgs are
 * not returned by `redeem_invitations`, so read the user's active memberships
 * (bounded, the user's own rows on their own session) and expire each. Same
 * context rules and render-phase no-op as `expireRedeemedAccess`. Best
 * effort: a failed read must never fail the sign-in it rides on.
 */
async function expireJoinedOrgMembers(
  client: SupabaseClient<Database>,
  userId: string,
): Promise<void> {
  let orgs: { org_id: string }[] = [];
  try {
    const { data } = await client
      .from("org_members")
      .select("org_id")
      .eq("user_id", userId)
      .is("deactivated_at", null)
      .limit(JOINED_ORGS_LIMIT);
    orgs = data ?? [];
  } catch {
    return;
  }
  for (const { org_id } of orgs) {
    try {
      revalidateTag(orgMembersTag(org_id), { expire: 0 });
    } catch {
      // Render phase: nothing to expire safely here.
    }
  }
}

/**
 * First-sign-in setup for an approved account: redeem pending invitations
 * FIRST, and only self-provision a new org when none were redeemed. Moved
 * unchanged out of the auth callback so the waiting screen can run it once the
 * account is approved.
 *
 * `supabase` defaults to the request's session client. The callback passes the
 * client it just exchanged the code on, so setup runs on exactly that session
 * (as it did inline).
 */
export async function finishAccountSetup(
  user: SessionUser,
  supabase?: SupabaseClient<Database>,
): Promise<FinishAccountSetupResult> {
  const client = supabase ?? (await createClient());
  const redeemed = await redeemInvitationsForUser(client);
  // `redeem_invitations` counts org memberships only: a FOLDER invitation for
  // someone already in the org is redeemed too but not counted, so expire this
  // user's cached access entries unconditionally (cheap, and only their own).
  expireRedeemedAccess(user.id);
  if (redeemed > 0) await expireJoinedOrgMembers(client, user.id);
  if (redeemed === 0) {
    const { error: provisionError } = await provisionAccountForUser(
      client,
      user,
    );
    // A failed provision leaves the user with zero orgs; the caller must not
    // drop them into a broken empty app shell.
    if (provisionError) return { ok: false, reason: "provisioning" };
  }
  return { ok: true };
}
