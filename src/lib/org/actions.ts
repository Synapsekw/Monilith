"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  leaveOrgSchema,
  updateOrgNameSchema,
  updateOrgTimezoneSchema,
} from "@/lib/validations/org";
import { fail, type ActionResult } from "@/lib/actions/result";

export async function updateOrgTimezone(input: {
  orgId: string;
  timezone: string;
}): Promise<ActionResult> {
  const parsed = updateOrgTimezoneSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("Not authenticated.");

  // RLS ("organizations: update if admin") gates this to org owners/admins.
  const { error } = await supabase
    .from("organizations")
    .update({ timezone: parsed.data.timezone })
    .eq("id", parsed.data.orgId);

  if (error) return fail("Could not update timezone.");

  revalidatePath("/settings/organization");
  return { ok: true, data: undefined };
}

/**
 * Rename the organization. RLS ("organizations: update if owner/admin") is the
 * security boundary — a plain member's update matches no row and the policy
 * denies it, so there is deliberately no extra role check here.
 */
export async function updateOrgName(input: {
  orgId: string;
  name: string;
}): Promise<ActionResult> {
  const parsed = updateOrgNameSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("Not authenticated.");

  const { error } = await supabase
    .from("organizations")
    .update({ name: parsed.data.name })
    .eq("id", parsed.data.orgId);

  if (error) return fail("Could not rename the organization.");

  revalidatePath("/settings/organization");
  return { ok: true, data: undefined };
}

/**
 * Remove yourself from the organization. Deleting the last owner would strand
 * the org — nobody could ever administer it again — so that case is refused
 * with an actionable message rather than a generic error. The delete itself
 * rides the "org_members: delete self only" policy; RLS, not this check, is
 * what stops you deleting anyone else's membership.
 */
export async function leaveOrg(input: {
  orgId: string;
}): Promise<ActionResult> {
  const parsed = leaveOrgSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("Not authenticated.");

  const { data: members, error: membersError } = await supabase.rpc(
    "get_org_members",
    { p_org_id: parsed.data.orgId },
  );
  if (membersError) return fail("Could not check your membership.");

  const rows = members ?? [];
  const me = rows.find((m) => m.user_id === user.id);
  if (!me) return fail("You are not a member of this organization.");

  const owners = rows.filter((m) => m.role === "owner");
  if (me.role === "owner" && owners.length <= 1) {
    return fail(
      "You are the only owner. Promote another member to owner before leaving.",
    );
  }

  const { error } = await supabase
    .from("org_members")
    .delete()
    .eq("org_id", parsed.data.orgId)
    .eq("user_id", user.id);

  if (error) return fail("Could not leave the organization.");

  revalidatePath("/settings");
  return { ok: true, data: undefined };
}
