"use server";

import { updateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getUserOrgs } from "@/lib/auth/session";
import { orgMembersTag, profileTag } from "@/lib/cache/tags";
import { pathFromPublicUrl } from "@/lib/profile/avatar-path";
import {
  updateProfileAvatarSchema,
  updateProfileFullNameSchema,
  updateProfileTimezoneSchema,
} from "@/lib/validations/profile";

const AVATARS_BUCKET = "avatars";

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

/** Expire the user's own profile cache AND every org roster that renders their
 *  avatar. The roster comment in lib/org/queries-cached.ts mandates the latter:
 *  the cached member roster stores `avatar_url` as a column, so a bare
 *  profileTag() would leave stale avatars in board cells / pickers / workload. */
async function invalidateProfileEverywhere(userId: string): Promise<void> {
  updateTag(profileTag(userId));
  const orgs = await getUserOrgs();
  for (const org of orgs) updateTag(orgMembersTag(org.id));
}

/**
 * Point the signed-in user's `profiles.avatar_url` at an object they just
 * uploaded to the public `avatars` bucket, mirror it into auth metadata, and
 * clean up their previous avatar object. The client uploads bytes directly
 * (Storage Insert policy); this action only receives the resulting object key.
 */
export async function updateProfileAvatar(input: {
  storagePath: string;
}): Promise<ActionResult> {
  const parsed = updateProfileAvatarSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("Not authenticated.");

  // Path-spoof guard: the object must be under the caller's own prefix. This
  // matches what the Storage Insert policy already enforced on upload; we
  // re-check so a spoofed key can never be persisted into avatar_url.
  if (!parsed.data.storagePath.startsWith(`${user.id}/`))
    return fail("Invalid avatar path.");

  // Read the current avatar so we can delete the old object after switching.
  const { data: prev } = await supabase
    .from("profiles")
    .select("avatar_url")
    .eq("id", user.id)
    .maybeSingle();

  const {
    data: { publicUrl },
  } = supabase.storage
    .from(AVATARS_BUCKET)
    .getPublicUrl(parsed.data.storagePath);

  // RLS ("profiles: update self") scopes the write to the caller's row.
  const { error } = await supabase
    .from("profiles")
    .update({ avatar_url: publicUrl })
    .eq("id", user.id);
  if (error) return fail("Could not update your avatar.");

  // Best-effort mirror into auth metadata (account menu / get_org_members RPC).
  await supabase.auth.updateUser({ data: { avatar_url: publicUrl } });

  await invalidateProfileEverywhere(user.id);

  // Best-effort: remove the previous object (skip if it's the same key).
  const oldPath = pathFromPublicUrl(prev?.avatar_url ?? null);
  if (oldPath && oldPath !== parsed.data.storagePath)
    await supabase.storage.from(AVATARS_BUCKET).remove([oldPath]);

  return { ok: true, data: undefined };
}

/** Clear the signed-in user's avatar (surfaces fall back to initials) and
 *  delete the stored object. */
export async function removeProfileAvatar(): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("Not authenticated.");

  const { data: prev } = await supabase
    .from("profiles")
    .select("avatar_url")
    .eq("id", user.id)
    .maybeSingle();

  const { error } = await supabase
    .from("profiles")
    .update({ avatar_url: null })
    .eq("id", user.id);
  if (error) return fail("Could not remove your avatar.");

  await supabase.auth.updateUser({ data: { avatar_url: null } });
  await invalidateProfileEverywhere(user.id);

  const oldPath = pathFromPublicUrl(prev?.avatar_url ?? null);
  if (oldPath) await supabase.storage.from(AVATARS_BUCKET).remove([oldPath]);

  return { ok: true, data: undefined };
}
