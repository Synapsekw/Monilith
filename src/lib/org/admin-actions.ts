"use server";

import { revalidatePath, updateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  boardsTag,
  orgAdminTag,
  orgMembersTag,
  sharedBoardsTag,
} from "@/lib/cache/tags";
import {
  setMemberRoleSchema,
  memberTargetSchema,
  inviteMemberSchema,
  revokeInviteSchema,
} from "@/lib/validations/admin";
import { fail, type ActionResult } from "@/lib/actions/result";

const ok = (): ActionResult => ({ ok: true, data: undefined });

/** Map raised SQL exception messages to friendly, non-leaking copy. */
function friendlyMemberError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("last owner")) return "Can't change the last owner's role.";
  if (m.includes("last active owner"))
    return "Can't deactivate the last active owner.";
  if (m.includes("admins cannot"))
    return "Admins can't manage owners or other admins.";
  if (m.includes("not authorized"))
    return "You don't have permission to do that.";
  if (m.includes("member not found")) return "That member no longer exists.";
  return "Something went wrong. Please try again.";
}

export async function setMemberRole(input: unknown): Promise<ActionResult> {
  const parsed = setMemberRoleSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_member_role", {
    p_org_id: parsed.data.orgId,
    p_user_id: parsed.data.userId,
    p_new_role: parsed.data.role,
  });
  if (error) return fail(friendlyMemberError(error.message));
  updateTag(orgAdminTag(parsed.data.userId, parsed.data.orgId));
  revalidatePath("/settings");
  return ok();
}

export async function removeMember(input: unknown): Promise<ActionResult> {
  const parsed = memberTargetSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_member", {
    p_org_id: parsed.data.orgId,
    p_user_id: parsed.data.userId,
  });
  if (error) return fail(friendlyMemberError(error.message));
  updateTag(orgAdminTag(parsed.data.userId, parsed.data.orgId));
  updateTag(orgMembersTag(parsed.data.orgId));
  // The target's cached board lists (listMyBoardsCached / listSharedBoardsCached /
  // listReadableBoardsCached all hang off these two tags) must drop immediately
  // when their membership flips — don't wait out the nav TTL.
  updateTag(boardsTag(parsed.data.userId));
  updateTag(sharedBoardsTag(parsed.data.userId));
  revalidatePath("/settings");
  return ok();
}

export async function deactivateMember(input: unknown): Promise<ActionResult> {
  const parsed = memberTargetSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  const supabase = await createClient();
  const { error } = await supabase.rpc("deactivate_member", {
    p_org_id: parsed.data.orgId,
    p_user_id: parsed.data.userId,
  });
  if (error) return fail(friendlyMemberError(error.message));
  updateTag(orgAdminTag(parsed.data.userId, parsed.data.orgId));
  updateTag(orgMembersTag(parsed.data.orgId));
  // See removeMember: drop the target's cached board lists immediately.
  updateTag(boardsTag(parsed.data.userId));
  updateTag(sharedBoardsTag(parsed.data.userId));
  revalidatePath("/settings");
  return ok();
}

export async function reactivateMember(input: unknown): Promise<ActionResult> {
  const parsed = memberTargetSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  const supabase = await createClient();
  const { error } = await supabase.rpc("reactivate_member", {
    p_org_id: parsed.data.orgId,
    p_user_id: parsed.data.userId,
  });
  if (error) return fail(friendlyMemberError(error.message));
  updateTag(orgAdminTag(parsed.data.userId, parsed.data.orgId));
  updateTag(orgMembersTag(parsed.data.orgId));
  // See removeMember: drop the target's cached board lists immediately.
  updateTag(boardsTag(parsed.data.userId));
  updateTag(sharedBoardsTag(parsed.data.userId));
  revalidatePath("/settings");
  return ok();
}

/** Auth-plane: create-or-invite the user and record the invitation.
 *  `data.emailSent` is false when the invite row persisted but the invite email
 *  couldn't be delivered — the caller warns the admin so it isn't a silent gap. */
export async function inviteMember(
  input: unknown,
): Promise<ActionResult<{ emailSent: boolean }>> {
  const parsed = inviteMemberSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  const { orgId, email, role } = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("Not authenticated.");

  // RLS gates this insert to org owners/admins; unique partial index blocks dupes.
  const { error: insErr } = await supabase
    .from("org_invitations")
    .insert({ org_id: orgId, email, role, invited_by: user.id });
  if (insErr) {
    if (insErr.code === "23505")
      return fail("There's already a pending invite for that email.");
    return fail("You don't have permission to invite members.");
  }

  // Service role: create the auth user if absent + send the branded invite email.
  // If the email is already a registered user, swallow — they redeem on next login.
  const svc = createServiceClient();
  const { error: inviteErr } = await svc.auth.admin.inviteUserByEmail(email);
  // A "User already registered" error is expected & fine; only surface unexpected ones.
  let emailSent = true;
  if (inviteErr && !/already.*regist/i.test(inviteErr.message)) {
    // Invitation row persists; user can still redeem after a normal sign-in — but
    // the branded email failed to send, so report it back rather than swallow it.
    console.error("[inviteMember] invite email delivery failed", {
      orgId,
      email,
      error: inviteErr.message,
    });
    emailSent = false;
  }

  // Compliance-relevant audit trail (who invited whom). Best-effort: a failed
  // write must not fail the invite, but it must not be silent either.
  const { error: auditErr } = await svc.from("admin_audit_log").insert({
    org_id: orgId,
    actor_id: user.id,
    actor_kind: "org",
    action: "member.invited",
    target_email: email,
    metadata: { role },
  });
  if (auditErr)
    console.error("[inviteMember] audit-log insert failed (compliance)", {
      orgId,
      action: "member.invited",
      error: auditErr.message,
    });

  revalidatePath("/settings");
  return { ok: true, data: { emailSent } };
}

export async function revokeInvite(input: unknown): Promise<ActionResult> {
  const parsed = revokeInviteSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("Not authenticated.");
  // RLS update policy gates to org admins.
  const { data, error } = await supabase
    .from("org_invitations")
    .update({ status: "revoked" })
    .eq("id", parsed.data.inviteId)
    .eq("status", "pending")
    .select("org_id")
    .maybeSingle();
  if (error || !data) return fail("Could not revoke that invitation.");
  // Compliance-relevant audit trail. Best-effort: don't fail the revoke on a
  // logging error, but surface it rather than dropping it silently.
  const { error: auditErr } = await createServiceClient()
    .from("admin_audit_log")
    .insert({
      org_id: data.org_id,
      actor_id: user.id,
      actor_kind: "org",
      action: "member.invite_revoked",
      metadata: {},
    });
  if (auditErr)
    console.error("[revokeInvite] audit-log insert failed (compliance)", {
      orgId: data.org_id,
      action: "member.invite_revoked",
      error: auditErr.message,
    });
  revalidatePath("/settings");
  return ok();
}

/** Auth-plane: send the target a Supabase password-recovery email. */
export async function resetMemberPassword(
  input: unknown,
): Promise<ActionResult> {
  const parsed = memberTargetSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("Not authenticated.");
  // Authz: caller must be owner/admin of the org.
  const { data: allowed } = await supabase.rpc("has_org_role", {
    p_org_id: parsed.data.orgId,
    p_roles: ["owner", "admin"],
  });
  if (!allowed) return fail("You don't have permission to do that.");

  // Authz scope: the target must actually belong to THIS org. Without this an
  // org admin could trigger a service-role recovery email for ANY platform
  // user id. Read via the RLS-scoped client — the admin can see their own org's
  // members, and a non-member simply returns no row.
  const { data: membership } = await supabase
    .from("org_members")
    .select("user_id")
    .eq("org_id", parsed.data.orgId)
    .eq("user_id", parsed.data.userId)
    .maybeSingle();
  if (!membership) return fail("That member no longer exists.");

  const svc = createServiceClient();
  const { data: target, error: lookErr } = await svc.auth.admin.getUserById(
    parsed.data.userId,
  );
  if (lookErr || !target.user?.email)
    return fail("Could not find that member.");

  const { error: resetErr } = await supabase.auth.resetPasswordForEmail(
    target.user.email,
  );
  if (resetErr) return fail("Could not send the reset email.");

  await svc.from("admin_audit_log").insert({
    org_id: parsed.data.orgId,
    actor_id: user.id,
    actor_kind: "org",
    action: "member.password_reset",
    target_user_id: parsed.data.userId,
    metadata: {},
  });
  revalidatePath("/settings");
  return ok();
}
