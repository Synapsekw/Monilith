import type { SupabaseClient } from "@supabase/supabase-js";
import { updateTag } from "next/cache";
import type { Database } from "@/types/database.types";
import { boardsTag, sharedBoardsTag } from "@/lib/cache/tags";
import { getBoardAccessCore } from "@/lib/boards/queries";
import { fail, type ActionResult } from "@/lib/actions/result";

/** Create a board with auto-seeded Group 1 + Status/Owner/Date via RPC. */
export async function createBoardCore(
  supabase: SupabaseClient<Database>,
  input: { workspaceId: string; name: string },
): Promise<ActionResult<{ boardId: string }>> {
  const { data, error } = await supabase.rpc("create_board", {
    p_workspace_id: input.workspaceId,
    p_name: input.name,
  });
  if (error || !data) return fail(error?.message ?? "Could not create board.");
  return { ok: true, data: { boardId: data.id } };
}

/**
 * Rename a board and expire every board_members grantee's cached
 * shared-boards entry (`shared-boards:user:<id>`) so recipients stop seeing
 * the stale name. Does NOT call `revalidatePath` — that is a Next.js request
 * concern the caller (the Server Action) still owns.
 */
export async function renameBoardCore(
  supabase: SupabaseClient<Database>,
  input: { boardId: string; name: string },
): Promise<ActionResult> {
  const { error } = await supabase
    .from("boards")
    .update({ name: input.name })
    .eq("id", input.boardId);
  if (error) return fail(error.message);

  const { data: members } = await supabase
    .from("board_members")
    .select("user_id")
    .eq("board_id", input.boardId);
  for (const m of members ?? []) updateTag(sharedBoardsTag(m.user_id));

  return { ok: true, data: undefined };
}

/**
 * Duplicate a board's full structure (groups, columns, items, cells) via RPC.
 * Any member (owner/editor/viewer) may duplicate — they can already read the
 * data. Non-members get the same "not found" message as a missing board, so
 * this does not leak board existence (spec F4 / decision D5).
 */
export async function duplicateBoardCore(
  supabase: SupabaseClient<Database>,
  userId: string,
  input: { boardId: string },
): Promise<ActionResult<{ boardId: string }>> {
  const access = await getBoardAccessCore(supabase, userId, input.boardId);
  if (!access) return fail("Board not found.");

  const { data, error } = await supabase.rpc("duplicate_board_structure", {
    p_board_id: input.boardId,
  });
  if (error || !data)
    return fail(error?.message ?? "Could not duplicate board.");
  return { ok: true, data: { boardId: data.id } };
}

/**
 * Archive a board (O(1) row update). Owner-only, mirroring `deleteBoard`'s
 * defense-in-depth guard: an RLS-filtered update affecting 0 rows is a lying
 * success, so `getBoardAccessCore` is checked explicitly — never
 * `getBoardAccess`, which reads cookies and would throw on the MCP path. Its
 * groups/items are NOT cascade-archived — the board is hidden from every list
 * and its page is guarded, so they are already invisible; restore just clears
 * the flag and everything reappears.
 */
export async function archiveBoardCore(
  supabase: SupabaseClient<Database>,
  userId: string,
  input: { boardId: string },
): Promise<ActionResult> {
  const access = await getBoardAccessCore(supabase, userId, input.boardId);
  if (access !== "owner")
    return fail("Only the board owner can delete this board.");

  const { error } = await supabase
    .from("boards")
    .update({
      archived_at: new Date().toISOString(),
      archived_by: userId,
    })
    .eq("id", input.boardId);
  if (error) return fail(error.message);
  return { ok: true, data: undefined };
}

/** Restore an archived board (clears the flag). Owner-only (mirrors archive). */
export async function restoreBoardCore(
  supabase: SupabaseClient<Database>,
  userId: string,
  input: { boardId: string },
): Promise<ActionResult> {
  const access = await getBoardAccessCore(supabase, userId, input.boardId);
  if (access !== "owner")
    return fail("Only the board owner can restore this board.");

  const { error } = await supabase
    .from("boards")
    .update({ archived_at: null, archived_by: null })
    .eq("id", input.boardId);
  if (error) return fail(error.message);
  return { ok: true, data: undefined };
}

/**
 * Leave a board someone else shared with me: delete MY `board_members` grant,
 * and nothing else. The board, its content and every other member's access are
 * untouched — this is "remove it from my view", not a delete.
 *
 * The owner cannot leave (they have no grant to drop; they delete instead).
 * RLS lets a member delete only the row whose `user_id` is their own
 * ("board_members: member leaves"), and the delete RETURNS what it removed: an
 * RLS-filtered delete of 0 rows is otherwise a lying success, so "nothing
 * removed" is reported as not found.
 *
 * Expires the leaver's "Shared with me" list and the owner's board list (whose
 * shared marker counts grants).
 */
export async function leaveBoardCore(
  supabase: SupabaseClient<Database>,
  userId: string,
  input: { boardId: string },
): Promise<ActionResult> {
  const { data: board } = await supabase
    .from("boards")
    .select("created_by")
    .eq("id", input.boardId)
    .maybeSingle();
  if (!board) return fail("Board not found.");
  if (board.created_by === userId)
    return fail("You own this board. Delete it instead of leaving.");

  const { data: removed, error } = await supabase
    .from("board_members")
    .delete()
    .eq("board_id", input.boardId)
    .eq("user_id", userId)
    .select("board_id");
  if (error) return fail(error.message);
  if (!removed || removed.length === 0) return fail("Board not found.");

  updateTag(sharedBoardsTag(userId));
  if (board.created_by) updateTag(boardsTag(board.created_by));
  return { ok: true, data: undefined };
}
