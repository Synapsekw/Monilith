"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { typedRpc } from "@/lib/supabase/typed-rpc";
import { getBoardStatusColumns, type StatusColumn } from "@/lib/goals/queries";
import {
  createGoalSchema,
  deleteGoalSchema,
  reorderGoalSchema,
  setGoalLinksSchema,
  updateGoalSchema,
} from "@/lib/validations/goals";
import type { Tables, TablesUpdate } from "@/types/database.types";
import { fail, type ActionResult } from "@/lib/actions/result";

export async function createGoal(
  input: z.input<typeof createGoalSchema>,
): Promise<ActionResult<{ goal: Tables<"goals"> }>> {
  const parsed = createGoalSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");
  const d = parsed.data;

  const supabase = await createClient();
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

  revalidatePath("/goals");
  return { ok: true, data: { goal: data as Tables<"goals"> } };
}

export async function updateGoal(
  input: z.input<typeof updateGoalSchema>,
): Promise<ActionResult<null>> {
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

  const supabase = await createClient();
  const { error } = await supabase
    .from("goals")
    .update(patch)
    .eq("id", d.goalId);
  if (error) return fail(error.message);

  revalidatePath("/goals");
  return { ok: true, data: null };
}

export async function reorderGoal(
  input: z.input<typeof reorderGoalSchema>,
): Promise<ActionResult<null>> {
  const parsed = reorderGoalSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const { error } = await supabase
    .from("goals")
    .update({ position: parsed.data.position })
    .eq("id", parsed.data.goalId);
  if (error) return fail(error.message);

  revalidatePath("/goals");
  return { ok: true, data: null };
}

export async function deleteGoal(
  input: z.input<typeof deleteGoalSchema>,
): Promise<ActionResult<null>> {
  const parsed = deleteGoalSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const { error } = await supabase
    .from("goals")
    .delete()
    .eq("id", parsed.data.goalId);
  if (error) return fail(error.message);

  revalidatePath("/goals");
  return { ok: true, data: null };
}

export async function setGoalLinks(
  input: z.input<typeof setGoalLinksSchema>,
): Promise<ActionResult<null>> {
  const parsed = setGoalLinksSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const { error } = await typedRpc(supabase, "set_goal_links", {
    p_goal_id: parsed.data.goalId,
    p_links: parsed.data.links.map((l) => ({
      board_id: l.boardId,
      done_column_id: l.doneColumnId,
      done_option_ids: l.doneOptionIds,
    })),
  });
  if (error) return fail(error.message);

  revalidatePath("/goals");
  return { ok: true, data: null };
}

export async function getStatusColumnsForBoard(
  boardId: string,
): Promise<ActionResult<{ columns: StatusColumn[] }>> {
  const parsed = z.string().uuid().safeParse(boardId);
  if (!parsed.success) return fail("Invalid board");
  const columns = await getBoardStatusColumns(parsed.data);
  return { ok: true, data: { columns } };
}
