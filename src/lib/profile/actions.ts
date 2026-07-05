"use server";

import { updateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { profileTag } from "@/lib/cache/tags";
import {
  updateProfileFullNameSchema,
  updateProfileTimezoneSchema,
} from "@/lib/validations/profile";

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

  // Read-your-own-writes: immediately expire this user's cached timezone so the
  // shell TimeZoneBoundary and the settings page reflect the new value on the
  // next render of ANY route (not just /settings, which the old path revalidate
  // was scoped to). Both consumers read `getUserTimeZoneCached(user.id)`.
  updateTag(profileTag(user.id));
  return { ok: true, data: undefined };
}

/**
 * Set (or clear) the signed-in user's display name. Writes both sources of
 * truth the app reads a name from, so every surface agrees:
 *  - `profiles.full_name` — board people cells, workload, presence, dashboards.
 *  - auth `user_metadata.full_name` — the header account menu and the
 *    `get_org_members` RPC (settings members table), which read
 *    `raw_user_meta_data`. Kept in sync here to avoid a stale header/roster.
 * An empty value clears the name (surfaces fall back to the email).
 */
export async function updateProfileFullName(input: {
  fullName: string | null;
}): Promise<ActionResult> {
  const parsed = updateProfileFullNameSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("Not authenticated.");

  const fullName = parsed.data.fullName;

  // RLS ("profiles: update self") restricts the write to the caller's own row.
  const { error } = await supabase
    .from("profiles")
    .update({ full_name: fullName })
    .eq("id", user.id);

  if (error) return fail("Could not update your name.");

  // Best-effort mirror into auth metadata (self-scoped). If it fails the
  // profiles write already landed, so we don't fail the whole action.
  await supabase.auth.updateUser({ data: { full_name: fullName } });

  // Read-your-own-writes: expire this user's cached profile so any route that
  // reads it reflects the new name on the next render.
  updateTag(profileTag(user.id));
  return { ok: true, data: undefined };
}
