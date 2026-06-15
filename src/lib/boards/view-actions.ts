"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  createBoardViewSchema,
  deleteBoardViewSchema,
  updateBoardViewSchema,
} from "@/lib/validations/view-actions";
import type { ActionResult } from "@/lib/boards/actions";
import type { Json, TablesUpdate } from "@/types/database.types";

function fail(message: string): { ok: false; error: string } {
  return { ok: false, error: message };
}

const DEFAULT_NAME: Record<string, string> = {
  table: "Main Table",
  kanban: "Kanban",
};

export async function createBoardView(input: {
  boardId: string;
  kind: "table" | "kanban";
  name?: string;
}): Promise<ActionResult<{ viewId: string }>> {
  const parsed = createBoardViewSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_board_view", {
    p_board_id: parsed.data.boardId,
    p_kind: parsed.data.kind,
    p_name: parsed.data.name ?? DEFAULT_NAME[parsed.data.kind],
    p_config: {},
  });
  if (error || !data) return fail(error?.message ?? "Could not create view.");

  revalidatePath(`/boards/${parsed.data.boardId}`);
  return { ok: true, data: { viewId: data.id } };
}

export async function updateBoardView(input: {
  viewId: string;
  name?: string;
  config?: { group_column_id?: string | null };
}): Promise<ActionResult> {
  const parsed = updateBoardViewSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const patch: TablesUpdate<"board_views"> = {};
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  if (parsed.data.config !== undefined)
    patch.config = parsed.data.config as Json;
  if (Object.keys(patch).length === 0) return { ok: true, data: undefined };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("board_views")
    .update(patch)
    .eq("id", parsed.data.viewId)
    .select("board_id")
    .maybeSingle();
  if (error) return fail(error.message);
  if (!data) return fail("View not found.");

  revalidatePath(`/boards/${data.board_id}`);
  return { ok: true, data: undefined };
}

export async function deleteBoardView(input: {
  viewId: string;
}): Promise<ActionResult> {
  const parsed = deleteBoardViewSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const { data: view, error: viewErr } = await supabase
    .from("board_views")
    .select("board_id")
    .eq("id", parsed.data.viewId)
    .maybeSingle();
  if (viewErr || !view) return fail("View not found.");

  // Refuse to delete the board's last view (RLS-scoped count).
  const { count, error: countErr } = await supabase
    .from("board_views")
    .select("id", { count: "exact", head: true })
    .eq("board_id", view.board_id);
  if (countErr) return fail(countErr.message);
  if ((count ?? 0) <= 1) return fail("A board must keep at least one view.");

  const { error } = await supabase
    .from("board_views")
    .delete()
    .eq("id", parsed.data.viewId);
  if (error) return fail(error.message);

  revalidatePath(`/boards/${view.board_id}`);
  return { ok: true, data: undefined };
}
