"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { fail, type ActionResult } from "@/lib/actions/result";

export async function revokeConnectionAction(
  tokenId: string,
): Promise<ActionResult> {
  const user = await requireUser();
  const supabase = createServiceClient();
  // Hard-delete rather than soft-revoke: the oauth_tokens_before_delete
  // trigger (20260724133321_mcp_oauth.sql) frees the Vault secret behind
  // bridge_secret_id on DELETE only, never on UPDATE. A soft `revoked_at`
  // update stops the opaque MCP token from working but leaves a live
  // Supabase refresh/access token pair for the user's real account sitting
  // in Vault indefinitely.
  const { error } = await supabase
    .from("oauth_tokens")
    .delete()
    .eq("id", tokenId)
    .eq("user_id", user.id);
  if (error) return fail(error.message);
  revalidatePath("/settings");
  return { ok: true, data: undefined };
}
