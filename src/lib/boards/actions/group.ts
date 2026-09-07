"use server";

import { createClient } from "@/lib/supabase/server";
import {
  createGroupSchema,
  deleteGroupSchema,
  archiveGroupSchema,
  restoreGroupSchema,
  purgeGroupSchema,
  renameGroupSchema,
  reorderGroupSchema,
  updateGroupColorSchema,
} from "@/lib/validations/board-actions";
import { removeAttachmentObjects } from "@/lib/collaboration/attachment-cleanup";
import type { Tables } from "@/types/database.types";
import { fail, type ActionResult } from "@/lib/actions/result";
import {
  archiveGroupCore,
  createGroupsCore,
  recolorGroupCore,
  renameGroupCore,
  reorderGroupCore,
  restoreGroupCore,
} from "@/lib/boards/core/group";

// ── revalidatePath rule for within-board mutations ──────────────────────────
// The board client hydrates ONCE from the server payload (initialData,
// staleTime Infinity) and is kept fresh by optimistic cache patches + Supabase
// Realtime — it NEVER refetches the board RSC. So revalidatePath(`/boards/<id>`)
// on a within-board mutation invalidates a payload the mounted client discards:
// dead weight (9 queries, up to ~25k rows) on the hot path (every cell edit,
// rename, drag). We DROP it from all within-board hot-path mutations below.
// A fresh navigation to the board is dynamic and refetches regardless.
// Revalidation is KEPT only where a mutation feeds OTHER surfaces (nav/sidebar
// board lists) — those use updateTag(boardsTag/sharedBoardsTag); see
// createBoard/deleteBoard/renameBoard in ./board.
export async function renameGroup(input: {
  groupId: string;
  name: string;
}): Promise<ActionResult> {
  const parsed = renameGroupSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  return renameGroupCore(await createClient(), parsed.data);
}

/**
 * Create a single group. Delegates to the batched `createGroupsCore` with a
 * one-element array and unwraps its `BatchResult` back to this action's
 * long-standing `{ group }` shape — `useGroupMutations` and the AI write path
 * (`execute.ts`) both depend on that exact shape.
 */
export async function createGroup(input: {
  boardId: string;
  name: string;
}): Promise<ActionResult<{ group: Tables<"groups"> }>> {
  const parsed = createGroupSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const result = await createGroupsCore(await createClient(), {
    boardId: parsed.data.boardId,
    groups: [{ name: parsed.data.name }],
  });
  if (!result.ok) return result;

  const group = result.data.created[0];
  if (!group)
    return fail(result.data.errors[0]?.error ?? "Could not create group.");
  return { ok: true, data: { group } };
}

export async function reorderGroup(input: {
  groupId: string;
  position: number;
}): Promise<ActionResult> {
  const parsed = reorderGroupSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  return reorderGroupCore(await createClient(), parsed.data);
}

export async function updateGroupColor(input: {
  groupId: string;
  color: string;
}): Promise<ActionResult> {
  const parsed = updateGroupColorSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  return recolorGroupCore(await createClient(), parsed.data);
}

export async function deleteGroup(input: {
  groupId: string;
}): Promise<ActionResult> {
  const parsed = deleteGroupSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  // items cascade via the group_id FK (on delete cascade).
  const { data, error } = await supabase
    .from("groups")
    .delete()
    .eq("id", parsed.data.groupId)
    .select("board_id")
    .maybeSingle();
  if (error) return fail(error.message);
  if (!data) return fail("Group not found.");
  return { ok: true, data: undefined };
}

/** Archive a group (+ its live items and their subitems) via the cascade RPC. */
export async function archiveGroup(input: {
  groupId: string;
}): Promise<ActionResult> {
  const parsed = archiveGroupSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  return archiveGroupCore(await createClient(), parsed.data);
}

/** Restore a group + the items archived in the same batch via RPC. */
export async function restoreGroup(input: {
  groupId: string;
}): Promise<ActionResult> {
  const parsed = restoreGroupSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  return restoreGroupCore(await createClient(), parsed.data);
}

/**
 * Permanently delete an archived group (Trash-only). Items cascade via the
 * group_id FK, but their Storage objects do not — gather the group's items'
 * attachment paths first (mirror deleteBoard's query, narrowed to the group's
 * items), hard-delete the archived group (cascade), then free the objects.
 */
export async function purgeGroup(input: {
  groupId: string;
}): Promise<ActionResult> {
  const parsed = purgeGroupSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");
  const supabase = await createClient();

  // Gather attachment objects for every item in the group (subitems carry the
  // same denormalized group_id, so this one read covers them too).
  const { data: items } = await supabase
    .from("items")
    .select("id")
    .eq("group_id", parsed.data.groupId);
  const itemIds = (items ?? []).map((i) => i.id);
  const { data: attachments } =
    itemIds.length > 0
      ? await supabase
          .from("attachments")
          .select("storage_path")
          .in("item_id", itemIds)
      : { data: [] as { storage_path: string }[] };

  const { data, error } = await supabase
    .from("groups")
    .delete()
    .eq("id", parsed.data.groupId)
    .not("archived_at", "is", null)
    .select("board_id")
    .maybeSingle();
  if (error) return fail(error.message);
  if (!data) return fail("Group not found or not archived.");

  await removeAttachmentObjects((attachments ?? []).map((a) => a.storage_path));
  return { ok: true, data: undefined };
}
