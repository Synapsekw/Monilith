"use server";

import { updateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { typedRpc } from "@/lib/supabase/typed-rpc";
import { getUser } from "@/lib/auth/session";
import {
  createBoardSchema,
  createBoardFromTemplateSchema,
  deleteBoardSchema,
  duplicateBoardSchema,
  archiveBoardSchema,
  restoreBoardSchema,
  purgeBoardSchema,
  leaveBoardSchema,
  renameBoardSchema,
  reorderBoardSchema,
} from "@/lib/validations/board-actions";
import { removeAttachmentObjects } from "@/lib/collaboration/attachment-cleanup";
import { getBoardAccess } from "@/lib/boards/queries";
import { getTemplate } from "@/lib/boards/templates";
import { buildTemplatePayload } from "@/lib/boards/template-payload";
import { fail, type ActionResult } from "@/lib/actions/result";
import { invalidateMyBoards } from "@/lib/boards/actions/internal";
import { boardsTag } from "@/lib/cache/tags";
import {
  archiveBoardCore,
  leaveBoardCore,
  createBoardCore,
  duplicateBoardCore,
  renameBoardCore,
  restoreBoardCore,
} from "@/lib/boards/core/board";

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

  const result = await createBoardCore(await createClient(), parsed.data);
  if (result.ok) await invalidateMyBoards();
  return result;
}

export async function renameBoard(input: {
  boardId: string;
  name: string;
}): Promise<ActionResult> {
  const parsed = renameBoardSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  // The owner lookup rides alongside the rename (a primary-key point read, in
  // parallel — no added latency). `created_by` never changes, so reading it
  // concurrently with the name update is safe.
  const [result, { data: board }] = await Promise.all([
    renameBoardCore(supabase, parsed.data),
    supabase
      .from("boards")
      .select("created_by")
      .eq("id", parsed.data.boardId)
      .maybeSingle(),
  ]);
  if (!result.ok) return result;

  // Tags only — deliberately NO revalidatePath(`/boards/<id>`):
  //  - Nothing server-rendered on the board page needs it. The header reads the
  //    name from the client BoardCache, which the mutation already patched
  //    optimistically (gotcha-05), and the route sets no board-name metadata.
  //  - It was expensive. Expiring a route's implicit tag makes EVERY `use cache`
  //    read on that route miss (org members, folders, dashboards, workspaces,
  //    profile, …) — in this action's own re-render and for every other user
  //    who next opens the board.
  // What actually shows the name server-side is the sidebar list, served from
  // tagged caches: mine (invalidateMyBoards), every grantee's shared list
  // (renameBoardCore), and — when an editor renames someone else's board — the
  // owner's own list, which the path revalidation used to heal only by accident.
  await invalidateMyBoards();
  if (board?.created_by) updateTag(boardsTag(board.created_by));
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
  // Session helper (local JWKS verify), not `supabase.auth.getUser()`: a
  // drag-reorder needs only the owner id and should not pay an Auth round-trip.
  const user = await getUser();
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

  const userId = (await getUser())?.id;
  if (!userId) return fail("Board not found.");

  const result = await duplicateBoardCore(
    await createClient(),
    userId,
    parsed.data,
  );
  if (result.ok) await invalidateMyBoards();
  return result;
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

  const userId = (await getUser())?.id;
  if (!userId) return fail("Board not found.");

  const result = await archiveBoardCore(
    await createClient(),
    userId,
    parsed.data,
  );
  if (result.ok) await invalidateMyBoards();
  return result;
}

/**
 * Leave a board that someone else shared with me — removes it from my sidebar
 * and drops my access; the board itself and everyone else's access are
 * untouched. The owner cannot leave (they delete instead).
 */
export async function leaveBoard(input: {
  boardId: string;
}): Promise<ActionResult> {
  const parsed = leaveBoardSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const userId = (await getUser())?.id;
  if (!userId) return fail("Board not found.");

  return leaveBoardCore(await createClient(), userId, parsed.data);
}

/** Restore an archived board (clears the flag). Owner-only (mirrors archive). */
export async function restoreBoard(input: {
  boardId: string;
}): Promise<ActionResult> {
  const parsed = restoreBoardSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const userId = (await getUser())?.id;
  if (!userId) return fail("Board not found.");

  const result = await restoreBoardCore(
    await createClient(),
    userId,
    parsed.data,
  );
  if (result.ok) await invalidateMyBoards();
  return result;
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
