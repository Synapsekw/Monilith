"use server";

import { createClient } from "@/lib/supabase/server";
import { typedRpc } from "@/lib/supabase/typed-rpc";
import { fail, type ActionResult } from "@/lib/actions/result";
import { touchBoardVisitSchema } from "@/lib/validations/board-intelligence";

/**
 * Stamp "the caller had this board open just now" (board_visits upsert).
 *
 * Deliberately does NOT revalidate: this is per-user state that no other
 * client's query renders, and a `revalidatePath` here would re-run every board
 * query on the page to change nothing on screen (gotcha-09). The RPC is
 * SECURITY INVOKER, so RLS — own row AND can_read_board — is the authorization.
 * Callers treat failure as silent (spec §3.4).
 */
export async function touchBoardVisit(boardId: string): Promise<ActionResult> {
  const parsed = touchBoardVisitSchema.safeParse({ boardId });
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid");
  }

  const supabase = await createClient();
  const { error } = await typedRpc(supabase, "touch_board_visit", {
    p_board_id: parsed.data.boardId,
  });
  if (error) return fail(error.message);

  return { ok: true, data: undefined };
}
