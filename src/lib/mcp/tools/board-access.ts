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

/**
 * The subset of `boardIds` this caller can OPEN — ONE query, never N.
 *
 * Same guarantee as `canReadBoard`, set-based: RLS on `boards` already filters
 * the `in (…)` to the rows this user may read, so what comes back IS the
 * readable subset. Nothing else is needed to compute it, and nothing may be
 * inferred from what is missing — an id absent from the returned set is
 * "unreadable OR nonexistent", indistinguishable by construction.
 *
 * Why batched: a report can now span many boards (`report_boards`), and a probe
 * per board would be an N-query hot path over a growing table — the bounded-read
 * rule in AGENTS.md forbids it, and the tool tests assert exactly one probe.
 * Selecting only `id` keeps this a covering index probe.
 *
 * A DB failure is NOT "unreadable": it throws, exactly like `canReadBoard`, so
 * the handler's catch surfaces the real error. Folding an error into an empty
 * set would silently turn any outage into "not found" and, worse, would make a
 * transient failure look like a permission answer.
 *
 * Callers MUST fold "no readable board" into the SAME "not found" message they
 * use for a genuinely missing resource — otherwise the refusal discloses that
 * the resource (and the private board behind it) exists.
 */
export async function readableBoardIds(
  supabase: SupabaseClient<Database>,
  boardIds: string[],
): Promise<Set<string>> {
  const unique = [...new Set(boardIds)];
  // No ids to probe: skip the round-trip. `.in("id", [])` would be a guaranteed
  // empty result anyway, and the answer ("nothing readable") is already known.
  if (unique.length === 0) return new Set();

  const { data, error } = await supabase
    .from("boards")
    .select("id")
    .in("id", unique);
  if (error) throw new Error(`Failed to load boards: ${error.message}`);
  return new Set((data ?? []).map((b) => b.id));
}
