"use server";

import { revalidatePath, updateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { fail, type ActionResult } from "@/lib/actions/result";
import { sharedBoardsTag } from "@/lib/cache/tags";
import {
  shareBoardSchema,
  unshareBoardSchema,
} from "@/lib/validations/board-sharing";

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
  // The recipient's cached shared-boards list is what changed.
  updateTag(sharedBoardsTag(parsed.data.userId));
  revalidatePath("/boards", "layout");
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
  updateTag(sharedBoardsTag(parsed.data.userId));
  revalidatePath("/boards", "layout");
  return { ok: true, data: undefined };
}
