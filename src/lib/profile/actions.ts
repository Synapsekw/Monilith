"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { updateProfileTimezoneSchema } from "@/lib/validations/profile";

type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };
const fail = (error: string): ActionResult<never> => ({ ok: false, error });

/** Update the signed-in user's personal display timezone (null = Automatic). */
export async function updateProfileTimezone(input: {
  timezone: string | null;
}): Promise<ActionResult> {
  const parsed = updateProfileTimezoneSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("Not authenticated.");

  // RLS ("profiles: update self") restricts the write to the caller's own row.
  const { error } = await supabase
    .from("profiles")
    .update({ timezone: parsed.data.timezone })
    .eq("id", user.id);

  if (error) return fail("Could not update timezone.");

  revalidatePath("/settings");
  return { ok: true, data: undefined };
}
