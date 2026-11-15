"use server";

import { createClient } from "@/lib/supabase/server";
import { fail, type ActionResult } from "@/lib/actions/result";
import { folderAccessSchema } from "@/lib/validations/folder-sharing";
import { FOLDER_GONE_ERROR } from "./types";

/** Same cap as the share dialog's member list. */
const MEMBERS_LIMIT = 200;

/**
 * Which of a folder's members are guests of its organization, for the "Guest"
 * badge in the share dialog. Loaded with the dialog, never on first paint.
 *
 * Every read is on the caller's own client, so RLS decides: a caller who
 * cannot see the folder gets "not found", and a guest caller learns the role
 * only of people they already see in the list (their co-members).
 */
export async function loadFolderGuestIds(
  input: unknown,
): Promise<ActionResult<string[]>> {
  const parsed = folderAccessSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid input");
  const { folderId } = parsed.data;
  const supabase = await createClient();

  const [{ data: folder }, { data: members }] = await Promise.all([
    supabase
      .from("folders")
      .select("id, org_id")
      .eq("id", folderId)
      .maybeSingle(),
    supabase
      .from("folder_members")
      .select("user_id")
      .eq("folder_id", folderId)
      .order("created_at", { ascending: true })
      .limit(MEMBERS_LIMIT),
  ]);
  if (!folder) return fail(FOLDER_GONE_ERROR);
  const memberIds = (members ?? []).map((m) => m.user_id);
  if (memberIds.length === 0) return { ok: true, data: [] };

  const { data: guests, error } = await supabase
    .from("org_members")
    .select("user_id")
    .eq("org_id", folder.org_id)
    .eq("role", "guest")
    .in("user_id", memberIds);
  if (error) return fail("Something went wrong. Please try again.");
  return { ok: true, data: (guests ?? []).map((g) => g.user_id) };
}
