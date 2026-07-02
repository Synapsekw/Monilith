"use server";

import { updateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getUser, getUserOrgs } from "@/lib/auth/session";
import { workspacesTag } from "@/lib/cache/tags";
import { removeAttachmentObjects } from "@/lib/collaboration/attachment-cleanup";
import {
  createWorkspaceSchema,
  renameWorkspaceSchema,
  deleteWorkspaceSchema,
} from "@/lib/validations/workspace-actions";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

function fail(message: string): { ok: false; error: string } {
  return { ok: false, error: message };
}

export async function createWorkspace(input: {
  name: string;
}): Promise<ActionResult> {
  const parsed = createWorkspaceSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  // Org + creator are derived server-side; never trusted from the client.
  const [user, orgs] = await Promise.all([getUser(), getUserOrgs()]);
  const orgId = orgs[0]?.id;
  if (!user || !orgId) return fail("No organization found.");

  const supabase = await createClient();
  const { error } = await supabase.from("workspaces").insert({
    org_id: orgId,
    name: parsed.data.name,
    created_by: user.id,
  });
  if (error) return fail(error.message);

  updateTag(workspacesTag(orgId));
  return { ok: true, data: undefined };
}

export async function renameWorkspace(input: {
  workspaceId: string;
  name: string;
}): Promise<ActionResult> {
  const parsed = renameWorkspaceSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  // Org is derived server-side for the cache tag (single-org scoping, matching
  // the shell's `orgs[0]`); never trusted from the client.
  const orgId = (await getUserOrgs())[0]?.id;

  const supabase = await createClient();
  const { error } = await supabase
    .from("workspaces")
    .update({ name: parsed.data.name })
    .eq("id", parsed.data.workspaceId);
  if (error) return fail(error.message);

  if (orgId) updateTag(workspacesTag(orgId));
  return { ok: true, data: undefined };
}

export async function deleteWorkspace(input: {
  workspaceId: string;
}): Promise<ActionResult> {
  const parsed = deleteWorkspaceSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const orgId = (await getUserOrgs())[0]?.id;

  const supabase = await createClient();

  // An org must keep at least one workspace so boards always have a home.
  // RLS scopes this count to the caller's org.
  const { count, error: countError } = await supabase
    .from("workspaces")
    .select("id", { count: "exact", head: true });
  if (countError) return fail(countError.message);
  if ((count ?? 0) <= 1) return fail("You can't delete your only workspace.");

  // Board/dashboard/item rows cascade in the DB, but attachment Storage objects
  // do not. Gather every attachment under this workspace's boards first
  // (mirrors deleteBoard's cleanup).
  const { data: boards } = await supabase
    .from("boards")
    .select("id")
    .eq("workspace_id", parsed.data.workspaceId);
  const boardIds = (boards ?? []).map((b) => b.id);
  let storagePaths: string[] = [];
  if (boardIds.length > 0) {
    const { data: attachments } = await supabase
      .from("attachments")
      .select("storage_path")
      .in("board_id", boardIds);
    storagePaths = (attachments ?? []).map((a) => a.storage_path);
  }

  const { error } = await supabase
    .from("workspaces")
    .delete()
    .eq("id", parsed.data.workspaceId);
  if (error) return fail(error.message);

  await removeAttachmentObjects(storagePaths);

  if (orgId) updateTag(workspacesTag(orgId));
  return { ok: true, data: undefined };
}
