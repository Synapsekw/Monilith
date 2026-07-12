"use server";

import { revalidatePath, updateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { typedRpc } from "@/lib/supabase/typed-rpc";
import { getUser } from "@/lib/auth/session";
import { sharedBoardsTag } from "@/lib/cache/tags";
import {
  createBoardSchema,
  createBoardFromTemplateSchema,
  deleteBoardSchema,
  duplicateBoardSchema,
  archiveBoardSchema,
  restoreBoardSchema,
  purgeBoardSchema,
  renameBoardSchema,
  reorderBoardSchema,
} from "@/lib/validations/board-actions";
import { removeAttachmentObjects } from "@/lib/collaboration/attachment-cleanup";
import { getBoardAccess } from "@/lib/boards/queries";
import { getTemplate } from "@/lib/boards/templates";
import { buildTemplatePayload } from "@/lib/boards/template-payload";
import { fail, type ActionResult } from "@/lib/actions/result";
import { invalidateMyBoards } from "@/lib/boards/actions/internal";

/** Create a board pre-populated from a built-in template via an atomic RPC. */
export async function createBoardFromTemplate(input: {
  workspaceId: string;
  templateId: string;
  name: string;
}): Promise<ActionResult<{ boardId: string }>> {
  const parsed = createBoardFromTemplateSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const template = getTemplate(parsed.data.templateId);
  if (!template) return fail("Unknown template.");

  const payload = buildTemplatePayload(template);

  const supabase = await createClient();
  const { data, error } = await typedRpc(
    supabase,
    "create_board_from_template",
    {
      p_workspace_id: parsed.data.workspaceId,
      p_name: parsed.data.name,
      p_template: payload,
    },
  );
  if (error || !data) return fail(error?.message ?? "Could not create board.");

  await invalidateMyBoards();
  return { ok: true, data: { boardId: data.id } };
}

/** Create a board with auto-seeded Group 1 + Status/Owner/Date via RPC. */
export async function createBoard(input: {
  workspaceId: string;
  name: string;
}): Promise<ActionResult<{ boardId: string }>> {
  const parsed = createBoardSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_board", {
    p_workspace_id: parsed.data.workspaceId,
    p_name: parsed.data.name,
  });
  if (error || !data) return fail(error?.message ?? "Could not create board.");

  await invalidateMyBoards();
  return { ok: true, data: { boardId: data.id } };
}

export async function renameBoard(input: {
  boardId: string;
  name: string;
}): Promise<ActionResult> {
  const parsed = renameBoardSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const { error } = await supabase
    .from("boards")
    .update({ name: parsed.data.name })
    .eq("id", parsed.data.boardId);
  if (error) return fail(error.message);

  await invalidateMyBoards();

  // Recipients read this board's name from their cached shared-boards list
  // (`shared-boards:user:<id>`, served by listSharedBoardsCached). A rename must
  // drop THEIR entry too, or they keep the stale name until the nav TTL expires.
  // Fan out over every board_members grantee — this read is RLS-scoped to the
  // board the owner can already read, and returns non-owner members.
  const { data: members } = await supabase
    .from("board_members")
    .select("user_id")
    .eq("board_id", parsed.data.boardId);
  for (const m of members ?? []) updateTag(sharedBoardsTag(m.user_id));

  // The board name shows on the board page's own (uncached) header; the sidebar
  // list is served from the `boards:user:<me>` cache the updateTag above expired.
  revalidatePath(`/boards/${parsed.data.boardId}`);
  return { ok: true, data: undefined };
}

/**
 * Reorder a board in the current user's own sidebar list. `position` is a float
 * (midpoint strategy) computed client-side. Scoped to `created_by = me`: a user
 * can only reorder boards they own, and that column is read only by the owner —
 * so the order is personal per-user with no shared-order side effects.
 */
export async function reorderBoard(input: {
  boardId: string;
  position: number;
}): Promise<ActionResult> {
  const parsed = reorderBoardSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("Not authenticated.");

  const { data, error } = await supabase
    .from("boards")
    .update({ position: parsed.data.position })
    .eq("id", parsed.data.boardId)
    .eq("created_by", user.id)
    .select("id")
    .maybeSingle();
  if (error) return fail(error.message);
  if (!data) return fail("Board not found.");

  // No revalidate: the sidebar shows the new order optimistically and the
  // position is persisted, so a fresh load reads it back. Busting the shared
  // (app) layout here would reload the whole sidebar on the next navigation
  // (gotcha-44). create/rename/delete still revalidate — they change the list
  // membership/labels the optimistic state can't cover on its own.
  return { ok: true, data: undefined };
}

export async function deleteBoard(input: {
  boardId: string;
}): Promise<ActionResult> {
  const parsed = deleteBoardSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  // Defense in depth: RLS already blocks non-owners, but an RLS-filtered
  // delete affects 0 rows and returns no error — a lying success. Check
  // explicitly so non-owners get a real answer (spec F4 / decision D5).
  const access = await getBoardAccess(parsed.data.boardId);
  if (access !== "owner")
    return fail("Only the board owner can delete this board.");

  const supabase = await createClient();

  // Attachment rows cascade with the board; their Storage objects do not. Every
  // attachment carries a denormalized board_id, so one query covers all items.
  const { data: attachments } = await supabase
    .from("attachments")
    .select("storage_path")
    .eq("board_id", parsed.data.boardId);

  const { error } = await supabase
    .from("boards")
    .delete()
    .eq("id", parsed.data.boardId);
  if (error) return fail(error.message);

  await removeAttachmentObjects((attachments ?? []).map((a) => a.storage_path));

  await invalidateMyBoards();
  return { ok: true, data: undefined };
}

/** Duplicate a board's full structure (groups, columns, items, cells) via RPC. */
export async function duplicateBoard(input: {
  boardId: string;
}): Promise<ActionResult<{ boardId: string }>> {
  const parsed = duplicateBoardSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  // Any member (owner/editor/viewer) may duplicate — they can already read
  // the data. Non-members get the same message as a missing board so we
  // don't leak existence (spec F4 / decision D5).
  const access = await getBoardAccess(parsed.data.boardId);
  if (!access) return fail("Board not found.");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("duplicate_board_structure", {
    p_board_id: parsed.data.boardId,
  });
  if (error || !data)
    return fail(error?.message ?? "Could not duplicate board.");

  await invalidateMyBoards();
  return { ok: true, data: { boardId: data.id } };
}

/**
 * Archive a board (O(1) row update). Owner-only, mirroring deleteBoard's
 * defense-in-depth guard: an RLS-filtered update affecting 0 rows is a lying
 * success, so check access explicitly. Its groups/items are NOT cascade-archived
 * — the board is hidden from every list and its page is guarded, so they are
 * already invisible; restore just clears the flag and everything reappears.
 */
export async function archiveBoard(input: {
  boardId: string;
}): Promise<ActionResult> {
  const parsed = archiveBoardSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");
  const access = await getBoardAccess(parsed.data.boardId);
  if (access !== "owner")
    return fail("Only the board owner can delete this board.");
  const supabase = await createClient();
  const user = await getUser();
  const { error } = await supabase
    .from("boards")
    .update({
      archived_at: new Date().toISOString(),
      archived_by: user?.id ?? null,
    })
    .eq("id", parsed.data.boardId);
  if (error) return fail(error.message);
  await invalidateMyBoards();
  return { ok: true, data: undefined };
}

/** Restore an archived board (clears the flag). Owner-only (mirrors archive). */
export async function restoreBoard(input: {
  boardId: string;
}): Promise<ActionResult> {
  const parsed = restoreBoardSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");
  const access = await getBoardAccess(parsed.data.boardId);
  if (access !== "owner")
    return fail("Only the board owner can restore this board.");
  const supabase = await createClient();
  const { error } = await supabase
    .from("boards")
    .update({ archived_at: null, archived_by: null })
    .eq("id", parsed.data.boardId);
  if (error) return fail(error.message);
  await invalidateMyBoards();
  return { ok: true, data: undefined };
}

/**
 * Permanently delete an archived board (Trash-only). Today's deleteBoard body —
 * owner-only guard, free every attachment object on the board, hard-delete —
 * plus a guard that the board is already archived (0 rows removed ⇒ not archived).
 */
export async function purgeBoard(input: {
  boardId: string;
}): Promise<ActionResult> {
  const parsed = purgeBoardSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const access = await getBoardAccess(parsed.data.boardId);
  if (access !== "owner")
    return fail("Only the board owner can delete this board.");

  const supabase = await createClient();

  const { data: attachments } = await supabase
    .from("attachments")
    .select("storage_path")
    .eq("board_id", parsed.data.boardId);

  const { data, error } = await supabase
    .from("boards")
    .delete()
    .eq("id", parsed.data.boardId)
    .not("archived_at", "is", null)
    .select("id")
    .maybeSingle();
  if (error) return fail(error.message);
  if (!data) return fail("Board not found or not archived.");

  await removeAttachmentObjects((attachments ?? []).map((a) => a.storage_path));
  await invalidateMyBoards();
  return { ok: true, data: undefined };
}
