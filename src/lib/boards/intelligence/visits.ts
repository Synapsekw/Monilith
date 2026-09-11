import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

/**
 * When the caller last had this board open, as an ISO timestamp, or null on a
 * first visit. A point lookup on the (board_id, user_id) primary key — bounded
 * by construction, so it is safe on the board page's hot path (spec §8: "one
 * primary-key read on board_visits"). RLS already scopes rows to the caller;
 * the explicit user_id filter makes the index use obvious.
 *
 * Never throws: a missing row, an RLS denial or a transport error all resolve
 * to null — a missing "changed since" chip must not be able to break the board.
 */
export async function getBoardLastSeenAt(
  supabase: SupabaseClient<Database>,
  boardId: string,
  userId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("board_visits")
    .select("last_seen_at")
    .eq("user_id", userId)
    .eq("board_id", boardId)
    .maybeSingle();
  if (error || !data) return null;
  return data.last_seen_at;
}
