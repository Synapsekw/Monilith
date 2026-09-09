"use server";

import { createClient } from "@/lib/supabase/server";
import { typedRpc } from "@/lib/supabase/typed-rpc";
import { fail, type ActionResult } from "@/lib/actions/result";
import {
  saveBoardViewPrefsSchema,
  type BoardViewPrefsState,
} from "@/lib/validations/view-prefs";

/**
 * Persist the caller's view arrangement for one board.
 *
 * Deliberately does NOT revalidate. This is per-user chrome that no other
 * client's query renders, so a `revalidatePath` here would re-run every board
 * query on the page to change nothing on screen — the exact regression in
 * vault/decisions/2026-06-16-gotcha-09-rsc-nav-refetch-on-view-switch.md.
 *
 * The whole blob is written every time (the caller debounces and coalesces), so
 * there is no read-modify-write race between two tabs: last writer wins, which
 * is the right semantics for a personal layout preference.
 */
export async function saveBoardViewPrefs(input: {
  boardId: string;
  state: BoardViewPrefsState;
}): Promise<ActionResult> {
  const parsed = saveBoardViewPrefsSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid");
  }

  const supabase = await createClient();
  const { error } = await typedRpc(supabase, "save_board_view_prefs", {
    p_board_id: parsed.data.boardId,
    p_state: parsed.data.state,
  });
  if (error) return fail(error.message);

  return { ok: true, data: undefined };
}
