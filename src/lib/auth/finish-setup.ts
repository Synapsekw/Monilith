import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { provisionAccountForUser } from "@/lib/auth/provision";
import { redeemInvitationsForUser } from "@/lib/auth/redeem";
import type { SessionUser } from "@/lib/auth/session";
import type { Database } from "@/types/database.types";

export type FinishAccountSetupResult =
  { ok: true } | { ok: false; reason: "provisioning" };

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
