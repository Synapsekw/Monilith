import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

/** Accept any pending invitations matching the signed-in user's email.
 * Returns the number of org memberships created. */
export async function redeemInvitationsForUser(
  supabase: SupabaseClient<Database>,
): Promise<number> {
  const { data, error } = await supabase.rpc("redeem_invitations");
  if (error) return 0;
  return typeof data === "number" ? data : 0;
}
