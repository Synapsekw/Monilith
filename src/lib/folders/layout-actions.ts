"use server";

import { createClient } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth/session";
import { fail, type ActionResult } from "@/lib/actions/result";
import { saveFolderLayoutSchema } from "@/lib/validations/folder-layout";
import { FOLDER_GONE_ERROR } from "./types";

const STALE = "This layout changed — reload the page and try again.";

/**
 * The command center's ONE mutation. Everything else in edit mode is client
 * draft state.
 *
 * Concurrency is last-write-wins guarded by `version`: the update matches on
 * the version the client read, so a second editor's save fails loudly instead
 * of silently overwriting. `version: 0` means the folder has no row yet.
 *
 * No `updateTag(foldersTag(orgId))`: nothing cached holds the layout —
 * `buildFolderPayload` reads it uncached on the request's RLS client — so
 * invalidating that tag would only evict the sidebar nav cache on every save.
 * The client calls `router.refresh()`.
 */
export async function saveFolderLayout(input: {
  folderId: string;
  version: number;
  preset: string;
  config: unknown;
}): Promise<ActionResult<{ version: number }>> {
  const parsed = saveFolderLayoutSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid layout");
  const user = await getUser();
  if (!user) return fail("You must be signed in.");

  const supabase = await createClient();
  const { folderId, version, preset, config } = parsed.data;

  if (version === 0) {
    // The org comes from the FOLDER, not from the active-org cookie: the
    // folder page renders any folder RLS lets you read, with no active-org
    // gate, so a user in two orgs can legitimately be looking at a folder in
    // the org that isn't "active". Scoping the write by the cookie rejected
    // that save as "gone". This read runs on the request's RLS client, so a
    // folder the user cannot see comes back null — the genuine gone case, and
    // fail-closed: no cookie fallback, no service-role client.
    const { data: folder } = await supabase
      .from("folders")
      .select("org_id")
      .eq("id", folderId)
      .maybeSingle();
    if (!folder) return fail(FOLDER_GONE_ERROR);

    const { data, error } = await supabase
      .from("folder_layouts")
      .insert({
        folder_id: folderId,
        org_id: folder.org_id,
        preset,
        config,
        updated_by: user.id,
      })
      .select("version")
      .maybeSingle();
    // 23505 = unique_violation on the primary key: a SECOND editor got there
    // first while both held `version: 0`. That is a stale read, not a missing
    // folder, and the user's fix is to reload — same as the update path's
    // no-row-matched case below.
    if (error?.code === "23505") return fail(STALE);
    if (error || !data) return fail(FOLDER_GONE_ERROR);
    return { ok: true, data: { version: data.version } };
  }

  const { data, error } = await supabase
    .from("folder_layouts")
    .update({ preset, config, version: version + 1, updated_by: user.id })
    .eq("folder_id", folderId)
    .eq("version", version)
    .select("version")
    .maybeSingle();
  if (error) return fail(FOLDER_GONE_ERROR);
  if (!data) return fail(STALE);
  return { ok: true, data: { version: data.version } };
}
