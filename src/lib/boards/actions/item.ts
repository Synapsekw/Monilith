"use server";

import { createClient } from "@/lib/supabase/server";
import {
  createItemSchema,
  archiveItemSchema,
  restoreItemSchema,
  purgeItemSchema,
  renameItemSchema,
  addSubitemSchema,
  deleteItemSchema,
  reorderItemSchema,
  moveItemSchema,
} from "@/lib/validations/board-actions";
import { removeAttachmentObjects } from "@/lib/collaboration/attachment-cleanup";
import type { Tables } from "@/types/database.types";
import { fail, type ActionResult } from "@/lib/actions/result";
import {
  addSubitemCore,
  archiveItemCore,
  restoreItemCore,
  reorderItemCore,
  moveItemCore,
} from "@/lib/boards/core/item";

/** Create an item via RPC (server derives org_id/board_id and position). Returns the full created item row. */
export async function createItem(input: {
  groupId: string;
  name: string;
}): Promise<ActionResult<{ item: Tables<"items"> }>> {
  const parsed = createItemSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_item", {
    p_group_id: parsed.data.groupId,
    p_name: parsed.data.name,
  });
  if (error || !data) return fail(error?.message ?? "Could not create item.");
  return { ok: true, data: { item: data as Tables<"items"> } };
}

export async function renameItem(input: {
  itemId: string;
  name: string;
}): Promise<ActionResult> {
  const parsed = renameItemSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("items")
    .update({ name: parsed.data.name })
    .eq("id", parsed.data.itemId)
    .select("board_id")
    .maybeSingle();
  if (error) return fail(error.message);
  // maybeSingle() returns null data with no error when the item is missing or
  // hidden by RLS — treat that as a failure rather than a silent no-op success.
  if (!data) return fail("Item not found.");
  return { ok: true, data: undefined };
}

/** Create a subitem under a top-level parent. Derives org/board/group from the
 *  parent (RLS-scoped); the DB trigger enforces the single-level invariant. */
export async function addSubitem(input: {
  parentId: string;
  name: string;
}): Promise<ActionResult<{ item: Tables<"items"> }>> {
  const parsed = addSubitemSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  return addSubitemCore(supabase, parsed.data);
}

/**
 * Delete an item (or subitem). Subitems, cell values, and attachment *rows*
 * cascade via FKs; the underlying Storage objects do not, so gather their paths
 * (item + its subitems) before the cascade removes the rows, then free them
 * after the delete succeeds. See removeAttachmentObjects for why this needs the
 * service-role client.
 */
export async function deleteItem(input: {
  itemId: string;
}): Promise<ActionResult> {
  const parsed = deleteItemSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();

  const { data: subitems } = await supabase
    .from("items")
    .select("id")
    .eq("parent_id", parsed.data.itemId);
  const itemIds = [parsed.data.itemId, ...(subitems ?? []).map((s) => s.id)];
  const { data: attachments } = await supabase
    .from("attachments")
    .select("storage_path")
    .in("item_id", itemIds);

  const { data, error } = await supabase
    .from("items")
    .delete()
    .eq("id", parsed.data.itemId)
    .select("board_id")
    .maybeSingle();
  if (error) return fail(error.message);
  if (!data) return fail("Item not found.");

  await removeAttachmentObjects((attachments ?? []).map((a) => a.storage_path));
  return { ok: true, data: undefined };
}

// ── Soft-delete lifecycle: archive / restore / purge ─────────────────────────
// A delete now ARCHIVES (reversible) instead of destroying. Item/group cascade
// archive+restore run through SECURITY INVOKER RPCs (one transaction, RLS-scoped,
// shared timestamp so a batch restores as a unit). PERMANENT removal (`purge*`)
// reuses the old hard-delete bodies (+ Storage cleanup) and is guarded so only an
// already-archived row can be purged (Trash-only). The legacy `deleteItem` above
// stays in place until callers move.

/** Archive an item (+ its live subitems) via the cascade RPC. Reversible. */
export async function archiveItem(input: {
  itemId: string;
}): Promise<ActionResult> {
  const parsed = archiveItemSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");
  const supabase = await createClient();
  return archiveItemCore(supabase, parsed.data);
}

/** Restore an item archived in the same batch (matching timestamp) via RPC. */
export async function restoreItem(input: {
  itemId: string;
}): Promise<ActionResult> {
  const parsed = restoreItemSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");
  const supabase = await createClient();
  return restoreItemCore(supabase, parsed.data);
}

/**
 * Permanently delete an archived item (Trash-only). Today's deleteItem body —
 * gather Storage paths (item + subitems), hard-delete (FK cascade), free the
 * objects — plus a guard that the row is already archived: the delete is scoped
 * `archived_at is not null`, and 0 rows removed means "not found or not archived".
 */
export async function purgeItem(input: {
  itemId: string;
}): Promise<ActionResult> {
  const parsed = purgeItemSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");
  const supabase = await createClient();

  const { data: subitems } = await supabase
    .from("items")
    .select("id")
    .eq("parent_id", parsed.data.itemId);
  const itemIds = [parsed.data.itemId, ...(subitems ?? []).map((s) => s.id)];
  const { data: attachments } = await supabase
    .from("attachments")
    .select("storage_path")
    .in("item_id", itemIds);

  const { data, error } = await supabase
    .from("items")
    .delete()
    .eq("id", parsed.data.itemId)
    .not("archived_at", "is", null)
    .select("board_id")
    .maybeSingle();
  if (error) return fail(error.message);
  if (!data) return fail("Item not found or not archived.");

  await removeAttachmentObjects((attachments ?? []).map((a) => a.storage_path));
  return { ok: true, data: undefined };
}

/** Update an item's position (subitem reorder within a parent). */
export async function reorderItem(input: {
  itemId: string;
  position: number;
}): Promise<ActionResult> {
  const parsed = reorderItemSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  return reorderItemCore(supabase, parsed.data);
}

/**
 * Move a top-level item to a different group on the same board. When
 * `position` is given (drag-drop exact spot), places the item there;
 * otherwise appends it to the end of the target group (position = after the
 * current last top-level row). Drags its subitems' denormalized `group_id`
 * along so they stay under the parent. RLS scopes every read/write to the
 * caller's org; the explicit same-board + top-level guards give a real answer
 * instead of an RLS-filtered silent no-op (mirrors deleteItem's
 * defense-in-depth). Reused per-item by the bulk "Move to group" wrapper so
 * its authorization is identical to a single move.
 */
export async function moveItem(input: {
  itemId: string;
  groupId: string;
  position?: number;
}): Promise<ActionResult<{ item: Tables<"items">; subitemIds: string[] }>> {
  const parsed = moveItemSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  return moveItemCore(supabase, parsed.data);
}
