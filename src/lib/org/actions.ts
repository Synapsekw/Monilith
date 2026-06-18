"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { updateOrgTimezoneSchema } from "@/lib/validations/org";

type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };
const fail = (error: string): ActionResult<never> => ({ ok: false, error });

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

  revalidatePath("/settings");
  return { ok: true, data: undefined };
}
