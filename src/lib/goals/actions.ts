"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { getBoardStatusColumns, type StatusColumn } from "@/lib/goals/queries";
import {
  createGoalCore,
  deleteGoalCore,
  setGoalLinksCore,
  updateGoalCore,
} from "@/lib/goals/core";
import type {
  createGoalSchema,
  deleteGoalSchema,
  setGoalLinksSchema,
  updateGoalSchema,
} from "@/lib/validations/goals";
import type { Tables } from "@/types/database.types";
import { fail, type ActionResult } from "@/lib/actions/result";

/**
 * Cookie-bound wrappers. Each supplies the request's RLS client to its core in
 * `./core` and then does the one thing a core must not: revalidate this
 * deployment's routes. `manage_goal` over MCP calls the same cores with a
 * bridged client.
 */

export async function createGoal(
  input: z.input<typeof createGoalSchema>,
): Promise<ActionResult<{ goal: Tables<"goals"> }>> {
  const supabase = await createClient();
  const res = await createGoalCore(supabase, input);
  if (!res.ok) return res;

  revalidatePath("/goals");
  return res;
}

export async function updateGoal(
  input: z.input<typeof updateGoalSchema>,
): Promise<ActionResult<{ goal: Tables<"goals"> }>> {
  const supabase = await createClient();
  // NO revalidatePath("/goals"): a field blur reconciles the returned row into
  // the client tree (GoalsView.applyGoalPatch) for 0 refetches. Structural
  // edits (links/delete/reorder) still revalidate — auto_boards rollups and
  // tree shape can't be patched client-side.
  return updateGoalCore(supabase, input);
}

export async function deleteGoal(
  input: z.input<typeof deleteGoalSchema>,
): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const res = await deleteGoalCore(supabase, input);
  if (!res.ok) return res;

  revalidatePath("/goals");
  return res;
}

export async function setGoalLinks(
  input: z.input<typeof setGoalLinksSchema>,
): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const res = await setGoalLinksCore(supabase, input);
  if (!res.ok) return res;

  revalidatePath("/goals");
  return res;
}

export async function getStatusColumnsForBoard(
  boardId: string,
): Promise<ActionResult<{ columns: StatusColumn[] }>> {
  const parsed = z.string().uuid().safeParse(boardId);
  if (!parsed.success) return fail("Invalid board");

  // `getBoardStatusColumns` throws on a DB/RLS failure (deliberately — an empty
  // picker would misrepresent it). Convert it here so the declared
  // `ActionResult` contract holds and callers get their own error state.
  try {
    const columns = await getBoardStatusColumns(parsed.data);
    return { ok: true, data: { columns } };
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}
