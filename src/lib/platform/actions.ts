"use server";
import { revalidatePath, updateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { orgAdminTag } from "@/lib/cache/tags";
import { isPlatformAdmin } from "./guard";
import {
  platformSetOrgRoleSchema,
  platformUserTargetSchema,
  platformSetPasswordSchema,
} from "@/lib/validations/admin";

type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };
const fail = (error: string): ActionResult<never> => ({ ok: false, error });
const ok = (): ActionResult => ({ ok: true, data: undefined });

const BAN_FOREVER = "876000h"; // ~100 years

export async function platformSetOrgRole(
  input: unknown,
): Promise<ActionResult> {
  const parsed = platformSetOrgRoleSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  if (!(await isPlatformAdmin())) return fail("Not authorized.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("platform_set_org_role", {
    p_org_id: parsed.data.orgId,
    p_user_id: parsed.data.userId,
    p_role: parsed.data.role,
  });
  if (error) {
    if (/last owner/i.test(error.message))
      return fail("Can't demote the last owner.");
    return fail("Could not change that role.");
  }
  updateTag(orgAdminTag(parsed.data.userId, parsed.data.orgId));
  revalidatePath(`/admin/organizations/${parsed.data.orgId}`);
  return ok();
}

async function setUserBan(
  input: unknown,
  ban: boolean,
  action: string,
): Promise<ActionResult> {
  const parsed = platformUserTargetSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  const supabase = await createClient();
  const {
    data: { user: actor },
  } = await supabase.auth.getUser();
  if (!actor) return fail("Not authenticated.");
  if (!(await isPlatformAdmin())) return fail("Not authorized.");
  const svc = createServiceClient();
  const { data: updated, error } = await svc.auth.admin.updateUserById(
    parsed.data.userId,
    { ban_duration: ban ? BAN_FOREVER : "none" },
  );
  if (error)
    return fail(
      ban ? "Could not deactivate user." : "Could not reactivate user.",
    );
  await svc.from("admin_audit_log").insert({
    org_id: null,
    actor_id: actor.id,
    actor_kind: "platform",
    action,
    target_user_id: parsed.data.userId,
    // Record the email so the platform audit feed shows the subject (the feed
    // renders target_email).
    target_email: updated.user?.email ?? null,
    metadata: {},
  });
  revalidatePath("/admin");
  return ok();
}

// Server Actions in a "use server" module must be async function declarations
// (Turbopack rejects const-assigned arrow exports). Keep these as thin async
// wrappers around the shared setUserBan helper.
export async function platformDeactivateUser(
  input: unknown,
): Promise<ActionResult> {
  return setUserBan(input, true, "platform.user_deactivated");
}

export async function platformReactivateUser(
  input: unknown,
): Promise<ActionResult> {
  return setUserBan(input, false, "platform.user_reactivated");
}

/** Auth-plane: send the target user a Supabase password-recovery email. */
export async function platformResetUserPassword(
  input: unknown,
): Promise<ActionResult> {
  const parsed = platformUserTargetSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  const supabase = await createClient();
  const {
    data: { user: actor },
  } = await supabase.auth.getUser();
  if (!actor) return fail("Not authenticated.");
  if (!(await isPlatformAdmin())) return fail("Not authorized.");

  const svc = createServiceClient();
  const { data: target, error: lookErr } = await svc.auth.admin.getUserById(
    parsed.data.userId,
  );
  if (lookErr || !target.user?.email) return fail("Could not find that user.");

  const { error: resetErr } = await supabase.auth.resetPasswordForEmail(
    target.user.email,
  );
  if (resetErr) return fail("Could not send the reset email.");

  await svc.from("admin_audit_log").insert({
    org_id: null,
    actor_id: actor.id,
    actor_kind: "platform",
    action: "platform.user_password_reset",
    target_user_id: parsed.data.userId,
    target_email: target.user.email,
    metadata: {},
  });
  revalidatePath("/admin/users");
  return ok();
}

/** Set a temporary password and force a change at next login. */
export async function platformSetUserPassword(
  input: unknown,
): Promise<ActionResult> {
  const parsed = platformSetPasswordSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  const supabase = await createClient();
  const {
    data: { user: actor },
  } = await supabase.auth.getUser();
  if (!actor) return fail("Not authenticated.");
  if (!(await isPlatformAdmin())) return fail("Not authorized.");

  const svc = createServiceClient();
  const { data: target, error: lookErr } = await svc.auth.admin.getUserById(
    parsed.data.userId,
  );
  if (lookErr || !target.user) return fail("Could not find that user.");

  // Merge so we don't clobber existing app_metadata (e.g. provider claims).
  const { error: updErr } = await svc.auth.admin.updateUserById(
    parsed.data.userId,
    {
      password: parsed.data.password,
      app_metadata: {
        ...target.user.app_metadata,
        must_change_password: true,
      },
    },
  );
  if (updErr) return fail("Could not set the password.");

  await svc.from("admin_audit_log").insert({
    org_id: null,
    actor_id: actor.id,
    actor_kind: "platform",
    action: "platform.user_password_set",
    target_user_id: parsed.data.userId,
    target_email: target.user.email ?? null,
    metadata: {},
  });
  revalidatePath("/admin/users");
  return ok();
}

/** Hard-delete a user. Blocked if they're the sole active owner of any org. */
export async function platformDeleteUser(
  input: unknown,
): Promise<ActionResult> {
  const parsed = platformUserTargetSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  const supabase = await createClient();
  const {
    data: { user: actor },
  } = await supabase.auth.getUser();
  if (!actor) return fail("Not authenticated.");
  if (!(await isPlatformAdmin())) return fail("Not authorized.");
  if (actor.id === parsed.data.userId)
    return fail("You can't delete your own account.");

  const { data: soleOrgs, error: checkErr } = await supabase.rpc(
    "platform_user_sole_owned_orgs",
    { p_user_id: parsed.data.userId },
  );
  if (checkErr) return fail("Could not verify org ownership.");
  if (soleOrgs && soleOrgs.length > 0) {
    const names = soleOrgs.map((o) => o.org_name).join(", ");
    return fail(`Reassign ownership first — sole owner of: ${names}.`);
  }

  const svc = createServiceClient();
  // Capture email and audit BEFORE deletion so the record survives the cascade.
  const { data: target } = await svc.auth.admin.getUserById(parsed.data.userId);
  await svc.from("admin_audit_log").insert({
    org_id: null,
    actor_id: actor.id,
    actor_kind: "platform",
    action: "platform.user_deleted",
    target_user_id: parsed.data.userId,
    target_email: target?.user?.email ?? null,
    metadata: {},
  });

  const { error: delErr } = await svc.auth.admin.deleteUser(parsed.data.userId);
  if (delErr) return fail("Could not delete the user.");
  revalidatePath("/admin/users");
  return ok();
}
