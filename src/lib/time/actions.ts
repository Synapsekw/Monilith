"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { getActiveOrgId } from "@/lib/org/active";
import {
  searchAllocatableItems as searchAllocatableItemsQuery,
  type AllocatableItem,
} from "@/lib/time/queries";
import {
  upsertTimeAllocationSchema,
  deleteTimeAllocationSchema,
} from "@/lib/validations/time";
import { fail, type ActionResult } from "@/lib/actions/result";
import { upsertTimeAllocationCore } from "@/lib/time/allocation-core";

/** Upsert one card cell (self-only). The unique partial index drives the
 * upsert: (user_id, work_date, item_id) or (user_id, work_date, category).
 * RLS guarantees user_id = auth.uid(); we set it explicitly from the session.
 *
 * Thin cookie-binding wrapper: the actual write lives in
 * `upsertTimeAllocationCore` (`@/lib/time/allocation-core`), shared with the
 * MCP `log_time_allocation` tool so both paths produce identical writes. */
export async function upsertTimeAllocation(
  input: z.input<typeof upsertTimeAllocationSchema>,
): Promise<ActionResult<{ durationSecs: number }>> {
  const parsed = upsertTimeAllocationSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const orgId = await getActiveOrgId();
  if (!orgId) return fail("No organization.");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("Not authenticated.");

  const res = await upsertTimeAllocationCore(supabase, parsed.data, {
    userId: user.id,
    orgId,
  });
  if (!res.ok) return res;

  // NO revalidatePath("/time"): the card reconciles the written seconds into a
  // durable local overlay and coalesces one trailing router.refresh() per edit
  // burst. /workload is server-derived and has no such overlay, so keep it.
  revalidatePath("/workload");
  return res;
}

/** Server-action wrapper around the server-only item search so the client
 * AddRowPicker can call it directly (a client component cannot import the
 * "server-only" queries module). */
export async function searchAllocatableItems(
  query: string,
): Promise<AllocatableItem[]> {
  return searchAllocatableItemsQuery(query);
}

/** Delete one card cell (self-only), keyed by (workDate, itemId|category). */
export async function deleteTimeAllocation(
  input: z.input<typeof deleteTimeAllocationSchema>,
): Promise<ActionResult<null>> {
  const parsed = deleteTimeAllocationSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");
  const d = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("Not authenticated.");

  let query = supabase
    .from("time_allocations")
    .delete()
    .eq("user_id", user.id)
    .eq("work_date", d.workDate);
  query = d.itemId
    ? query.eq("item_id", d.itemId)
    : query.eq("category", d.category as string);

  const { error } = await query;
  if (error) return fail(error.message);

  // See upsertTimeAllocation: the card owns /time reconciliation via its overlay
  // + coalesced refresh; keep the /workload revalidate only.
  revalidatePath("/workload");
  return { ok: true, data: null };
}
