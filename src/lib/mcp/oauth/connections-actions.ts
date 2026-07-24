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
  const { error } = await supabase
    .from("oauth_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", tokenId)
    .eq("user_id", user.id);
  if (error) return fail(error.message);
  revalidatePath("/settings");
  return { ok: true, data: undefined };
}
