import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { fail, type ActionResult } from "@/lib/actions/result";
import { typedRpc } from "@/lib/supabase/typed-rpc";

/** The validated shape both callers pass — the output of
 *  `upsertTimeAllocationSchema` in `src/lib/validations/time.ts`. */
export type UpsertTimeAllocationInput = {
  workDate: string;
  itemId?: string | null;
  boardId?: string | null;
  category?: string | null;
  durationSecs: number;
  note?: string | null;
};

/**
 * Upsert one manual allocation cell (self-only). Client-injected so the `/time`
 * Server Action and the MCP tool share ONE implementation — the `upsertCellCore`
 * precedent (gotcha-60: the MCP write path silently diverging is what this
 * shape exists to prevent).
 *
 * Goes through the `upsert_time_allocation` RPC rather than
 * `.upsert(…, { onConflict })`, and NOT as an optimization: the table's two
 * unique indexes are PARTIAL, Postgres can only infer a partial unique index
 * when the ON CONFLICT arbiter repeats its WHERE predicate, and PostgREST's
 * `on_conflict=` parameter cannot express one. Every `.upsert()` here failed at
 * plan time with 42P10 — see migration 20260806060855.
 *
 * `ctx.userId` is NOT sent: the RPC derives the row's user from `auth.uid()`
 * itself, which makes writing another user's time structurally impossible. It
 * stays in the signature because callers pass an identity they already know and
 * a future divergence should be a type error, not a silent mis-attribution.
 *
 * `durationSecs: 0` clears the cell (the RPC deletes the row and returns null),
 * matching `upsertTimeAllocationSchema`'s "clear the cell to remove time" and
 * the `deleteTimeAllocation` action. The `/time` path never reaches it — its
 * Zod schema rejects `hours <= 0` before the call.
 */
export async function upsertTimeAllocationCore(
  supabase: SupabaseClient<Database>,
  input: UpsertTimeAllocationInput,
  ctx: { userId: string; orgId: string },
): Promise<ActionResult<{ durationSecs: number }>> {
  const { data, error } = await typedRpc(supabase, "upsert_time_allocation", {
    p_org_id: ctx.orgId,
    p_work_date: input.workDate,
    p_duration_secs: input.durationSecs,
    p_item_id: input.itemId ?? null,
    // A category row carries no board (constraint
    // time_allocations_category_no_board); on the item path a null lets the RPC
    // derive it from the item.
    p_board_id: input.itemId ? (input.boardId ?? null) : null,
    p_category: input.category ?? null,
    p_note: input.note ?? null,
  });
  if (error) return fail(error.message);
  // null = the row was cleared; report 0 stored seconds.
  return { ok: true, data: { durationSecs: data ?? 0 } };
}
