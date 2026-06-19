"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isPlatformAdmin } from "./guard";
import {
  platformSetOrgRoleSchema,
  platformUserTargetSchema,
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
  revalidatePath(`/admin/${parsed.data.orgId}`);
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
  const { error } = await svc.auth.admin.updateUserById(parsed.data.userId, {
    ban_duration: ban ? BAN_FOREVER : "none",
  });
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
    metadata: {},
  });
  revalidatePath("/admin");
  return ok();
}

export const platformDeactivateUser = (input: unknown) =>
  setUserBan(input, true, "platform.user_deactivated");
export const platformReactivateUser = (input: unknown) =>
  setUserBan(input, false, "platform.user_reactivated");
