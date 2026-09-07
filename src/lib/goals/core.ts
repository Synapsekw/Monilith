import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";

import { typedRpc } from "@/lib/supabase/typed-rpc";
import {
  createGoalSchema,
  deleteGoalSchema,
  setGoalLinksSchema,
  updateGoalSchema,
} from "@/lib/validations/goals";
import type { Database, Tables, TablesUpdate } from "@/types/database.types";
import { fail, type ActionResult } from "@/lib/actions/result";

/**
 * Client-injected cores for every goal MUTATION — one body, two transports
 * (the `"use server"` wrappers in `./actions`, and `manage_goal` over MCP).
 * `revalidatePath` stays in the wrapper: an MCP call has no route to revalidate.
 *
 * ORG DERIVATION, stated because it is not obvious: `create_goal` is a
 * SECURITY DEFINER function that resolves the org from the caller's
 * `org_members` row itself — there is no `p_org_id`. So no core here takes an
 * `orgId`; the MCP tool resolves one only to REFUSE a caller who names an org
 * they are not in, and echoes the org the row actually landed in.
 */

type Db = SupabaseClient<Database>;

export async function createGoalCore(
  supabase: Db,
  input: z.input<typeof createGoalSchema>,
): Promise<ActionResult<{ goal: Tables<"goals"> }>> {
  const parsed = createGoalSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");
  const d = parsed.data;

  const { data, error } = await typedRpc(supabase, "create_goal", {
    p_name: d.name,
    p_progress_mode: d.progressMode,
    p_owner_id: d.ownerId ?? null,
    p_parent_goal_id: d.parentGoalId ?? null,
    p_workspace_id: d.workspaceId ?? null,
    p_status: d.status ?? null,
    p_start_value: d.startValue ?? null,
    p_current_value: d.currentValue ?? null,
    p_target_value: d.targetValue ?? null,
    p_unit: d.unit ?? null,
    p_percent: d.percent ?? null,
    p_start_date: d.startDate ?? null,
    p_due_date: d.dueDate ?? null,
  });
  if (error || !data) return fail(error?.message ?? "Could not create goal.");

  return { ok: true, data: { goal: data as Tables<"goals"> } };
}

/**
 * Patch a goal. The patch is built from `"key" in input` on the RAW input, NOT
 * from the parsed output: every field is `.optional()` and most are
 * `.nullable()`, so "absent" and "explicitly null" are different intents and
 * only the raw object distinguishes them. Callers must therefore pass the
 * caller's own object through untouched — never a normalised one with every
 * key present.
 */
export async function updateGoalCore(
  supabase: Db,
  input: z.input<typeof updateGoalSchema>,
): Promise<ActionResult<{ goal: Tables<"goals"> }>> {
  const parsed = updateGoalSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");
  const d = parsed.data;

  const patch: TablesUpdate<"goals"> = {};
  if ("name" in input) patch.name = d.name;
  if ("description" in input) patch.description = d.description;
  if ("ownerId" in input) patch.owner_id = d.ownerId;
  if ("parentGoalId" in input) patch.parent_goal_id = d.parentGoalId;
  if ("workspaceId" in input) patch.workspace_id = d.workspaceId;
  if ("progressMode" in input) patch.progress_mode = d.progressMode;
  if ("status" in input) patch.status = d.status;
  if ("startValue" in input) patch.start_value = d.startValue;
  if ("currentValue" in input) patch.current_value = d.currentValue;
  if ("targetValue" in input) patch.target_value = d.targetValue;
  if ("unit" in input) patch.unit = d.unit;
  if ("percent" in input) patch.percent = d.percent;
  if ("startDate" in input) patch.start_date = d.startDate;
  if ("dueDate" in input) patch.due_date = d.dueDate;

  const { data, error } = await supabase
    .from("goals")
    .update(patch)
    .eq("id", d.goalId)
    .select()
    .single();
  if (error || !data) return fail(error?.message ?? "Could not update goal.");

  return { ok: true, data: { goal: data as Tables<"goals"> } };
}

export async function deleteGoalCore(
  supabase: Db,
  input: z.input<typeof deleteGoalSchema>,
): Promise<ActionResult<null>> {
  const parsed = deleteGoalSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const { error } = await supabase
    .from("goals")
    .delete()
    .eq("id", parsed.data.goalId);
  if (error) return fail(error.message);

  return { ok: true, data: null };
}

/** Atomic replace of a goal's board links (the RPC gates each board on `can_read_board`). */
export async function setGoalLinksCore(
  supabase: Db,
  input: z.input<typeof setGoalLinksSchema>,
): Promise<ActionResult<null>> {
  const parsed = setGoalLinksSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const { error } = await typedRpc(supabase, "set_goal_links", {
    p_goal_id: parsed.data.goalId,
    p_links: parsed.data.links.map((l) => ({
      board_id: l.boardId,
      done_column_id: l.doneColumnId,
      done_option_ids: l.doneOptionIds,
    })),
  });
  if (error) return fail(error.message);

  return { ok: true, data: null };
}
