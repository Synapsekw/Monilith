"use server";

import { createClient } from "@/lib/supabase/server";
import {
  createBoardViewSchema,
  deleteBoardViewSchema,
  updateBoardViewSchema,
} from "@/lib/validations/view-actions";
import { fail, type ActionResult } from "@/lib/actions/result";
import {
  createBoardViewCore,
  updateBoardViewCore,
  deleteBoardViewCore,
} from "@/lib/boards/core/view";

/**
 * Thin cookie-bound wrapper over {@link createBoardViewCore}. All behaviour —
 * the per-kind default name, the `create_board_view` RPC — lives in the core
 * so the `manage_view` MCP tool cannot diverge from this action. Only the Zod
 * parse stays here: it is the Server Action's own input boundary.
 */
export async function createBoardView(input: {
  boardId: string;
  kind: "table" | "kanban" | "calendar" | "timeline";
  name?: string;
}): Promise<ActionResult<{ viewId: string }>> {
  const parsed = createBoardViewSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  return createBoardViewCore(supabase, parsed.data);
}

/**
 * Thin cookie-bound wrapper over {@link updateBoardViewCore}. See
 * `createBoardView` above for why only the Zod parse stays here.
 */
export async function updateBoardView(input: {
  viewId: string;
  name?: string;
  config?: Record<string, unknown>;
}): Promise<ActionResult> {
  const parsed = updateBoardViewSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  return updateBoardViewCore(supabase, parsed.data);
}

/**
 * Thin cookie-bound wrapper over {@link deleteBoardViewCore}.
 *
 * No revalidation: the board client hydrates once and never refetches the RSC;
 * ViewSwitcher drives its own router.refresh()/push() after this resolves.
 */
export async function deleteBoardView(input: {
  viewId: string;
}): Promise<ActionResult> {
  const parsed = deleteBoardViewSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  return deleteBoardViewCore(supabase, parsed.data);
}
