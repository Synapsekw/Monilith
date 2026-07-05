import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

/**
 * Create the user's organization + default "Main" workspace on first confirmed
 * sign-in. Org name is carried from signup in user metadata (`org_name`) because
 * no session exists at signup time under email confirmation. Idempotent twice
 * over: we skip when the user already belongs to an org, and the underlying
 * `provision_account` RPC also returns the existing org rather than duplicating.
 */
export async function provisionAccountForUser(
  supabase: SupabaseClient<Database>,
  user: User,
): Promise<{ error: string | null }> {
  const orgName = user.user_metadata?.org_name;
  if (typeof orgName !== "string" || orgName.trim().length === 0)
    return { error: null };

  const { data: orgs } = await supabase
    .from("organizations")
    .select("id")
    .limit(1);
  if (orgs && orgs.length > 0) return { error: null };

  const { error } = await supabase.rpc("provision_account", {
    p_org_name: orgName.trim(),
  });
  if (error) {
    // A transient RPC failure here strands a confirmed user with zero orgs.
    // Surface it (the callback route redirects to an error page) rather than
    // silently continuing into an empty, broken app shell.
    console.error(
      `provision_account failed for user ${user.id}: ${error.message}`,
    );
    return { error: error.message };
  }
  return { error: null };
}
