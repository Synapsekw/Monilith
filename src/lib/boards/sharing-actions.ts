"use server";

import { updateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { fail, type ActionResult } from "@/lib/actions/result";
import { sharedBoardsTag } from "@/lib/cache/tags";
import { invalidateMyBoards } from "@/lib/boards/actions/internal";
import {
  shareBoardSchema,
  unshareBoardSchema,
} from "@/lib/validations/board-sharing";

/**
 * What a grant change makes stale, as tags — deliberately NOT
 * `revalidatePath("/boards", "layout")`, which expired the implicit tag every
 * `/boards/*` route reads its `use cache` entries under, so one share made
 * every cached read miss for every user on every board.
 *
 *  - the grantee's shared-boards list (`shared-boards:user:<grantee>`);
 *  - the owner's own list (`boards:user:<me>`), whose rows carry the
 *    `shared_out` marker. Only the owner can share (the RPCs enforce it), so
 *    the owner is the session user and `invalidateMyBoards` is exact.
 *
 * The share dialog's grant list is client state and needs neither.
 */
async function invalidateGrantLists(granteeId: string): Promise<void> {
  updateTag(sharedBoardsTag(granteeId));
  await invalidateMyBoards();
}

function friendly(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("board owner"))
    return "Only the board owner can manage sharing.";
  if (m.includes("not a member"))
    return "That person isn't in your organization yet.";
  return "Something went wrong. Please try again.";
}

export async function shareBoard(input: unknown): Promise<ActionResult> {
  const parsed = shareBoardSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  const supabase = await createClient();
  const { error } = await supabase.rpc("share_board", {
    p_board_id: parsed.data.boardId,
    p_user_id: parsed.data.userId,
    p_access: parsed.data.access,
  });
  if (error) return fail(friendly(error.message));
  await invalidateGrantLists(parsed.data.userId);
  return { ok: true, data: undefined };
}

export async function unshareBoard(input: unknown): Promise<ActionResult> {
  const parsed = unshareBoardSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  const supabase = await createClient();
  const { error } = await supabase.rpc("unshare_board", {
    p_board_id: parsed.data.boardId,
    p_user_id: parsed.data.userId,
  });
  if (error) return fail(friendly(error.message));
  await invalidateGrantLists(parsed.data.userId);
  return { ok: true, data: undefined };
}
