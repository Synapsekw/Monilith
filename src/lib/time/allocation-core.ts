import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { fail, type ActionResult } from "@/lib/actions/result";

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
 * `userId` is passed in, never read from `supabase.auth`: the RSC path already
 * knows it, and an auth lookup on a bridged client costs a GoTrue round-trip
 * per write. RLS still enforces `user_id = auth.uid()`, so a mismatched id
 * fails closed.
 *
 * The unique partial indexes drive the upsert: exactly one of itemId/category
 * is set, and that choice selects the conflict target.
 */
export async function upsertTimeAllocationCore(
  supabase: SupabaseClient<Database>,
  input: UpsertTimeAllocationInput,
  ctx: { userId: string; orgId: string },
): Promise<ActionResult<{ durationSecs: number }>> {
  const onConflict = input.itemId
    ? "user_id,work_date,item_id"
    : "user_id,work_date,category";

  const { error } = await supabase.from("time_allocations").upsert(
    {
      org_id: ctx.orgId,
      user_id: ctx.userId,
      work_date: input.workDate,
      item_id: input.itemId ?? null,
      board_id: input.itemId ? (input.boardId ?? null) : null,
      category: input.category ?? null,
      duration_secs: input.durationSecs,
      note: input.note ?? null,
    },
    { onConflict },
  );
  if (error) return fail(error.message);
  return { ok: true, data: { durationSecs: input.durationSecs } };
}
