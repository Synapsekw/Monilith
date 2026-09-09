import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import {
  EMPTY_BOARD_VIEW_PREFS,
  parseBoardViewPrefs,
  type ResolvedBoardViewPrefs,
} from "@/lib/validations/view-prefs";

/**
 * Read the caller's saved arrangement for one board.
 *
 * A point lookup on the (user_id, board_id) primary key — bounded by
 * construction, so it is safe on the board page's hot path. RLS already scopes
 * the row to the caller; the explicit user_id filter makes the index use
 * obvious and keeps the query honest if the policy ever changes.
 *
 * Never throws: a missing row, an RLS denial or a malformed blob all resolve to
 * the empty arrangement, because failing to remember a collapsed group must not
 * be able to break the board.
 */
export async function getBoardViewPrefs(
  supabase: SupabaseClient<Database>,
  boardId: string,
  userId: string,
): Promise<ResolvedBoardViewPrefs> {
  const { data, error } = await supabase
    .from("board_view_prefs")
    .select("state")
    .eq("user_id", userId)
    .eq("board_id", boardId)
    .maybeSingle();

  if (error || !data) return EMPTY_BOARD_VIEW_PREFS;
  return parseBoardViewPrefs(data.state);
}
