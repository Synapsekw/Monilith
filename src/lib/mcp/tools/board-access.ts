import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

/**
 * Can the connected user OPEN this board?
 *
 * `boards` read is `is_org_member(org_id) AND (created_by = auth.uid() OR
 * is_board_member(id))` — strictly narrower than the plain `is_org_member(org_id)`
 * that guards board-derived tables like `reports` and `dashboard_widgets`. So an
 * org member who is not on a private board can still read rows that DESCRIBE it
 * unless the tool prechecks the board itself. The web app does exactly this
 * precheck: `boards/[boardId]/reports/[reportId]/page.tsx` calls `notFound()`
 * when `getBoardPayload(boardId)` comes back null.
 *
 * Selecting only `id` keeps this a covering index probe, and the caller MUST
 * fold a `false` into the SAME "not found" message it uses for a genuinely
 * missing resource — otherwise the refusal itself discloses that the board (and
 * the report/widget hanging off it) exists.
 *
 * A DB failure is not "unreadable": it throws, so the handler's catch surfaces
 * the real error instead of silently reporting not-found.
 */
export async function canReadBoard(
  supabase: SupabaseClient<Database>,
  boardId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("boards")
    .select("id")
    .eq("id", boardId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load board: ${error.message}`);
  return data !== null;
}
