import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/types/database.types";
import { midpoint } from "@/lib/boards/position";
import { fail, type ActionResult } from "@/lib/actions/result";
import type { BatchResult } from "./batch";

/**
 * Create one or more groups on a board.
 *
 * The board is read ONCE, before the loop, and its `org_id` reused for every
 * insert — a read per entry would be an N-query hot path over a growing table
 * (working agreement #5), and it is the single most likely performance defect
 * in the batched creates.
 *
 * Partial success is a SUCCESS with a report attached. An entry that fails is
 * recorded by index and the rest proceed: the caller is a model that can read
 * `errors` and retry precisely, and failing the whole batch for one bad name
 * would throw away work that already landed.
 */
export async function createGroupsCore(
  supabase: SupabaseClient<Database>,
  input: { boardId: string; groups: { name: string }[] },
): Promise<ActionResult<BatchResult<Tables<"groups">>>> {
  const { data: board, error: boardErr } = await supabase
    .from("boards")
    .select("org_id")
    .eq("id", input.boardId)
    .maybeSingle();
  if (boardErr || !board) return fail("Board not found.");

  const { data: last } = await supabase
    .from("groups")
    .select("position")
    .eq("board_id", input.boardId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  let position = last?.position ?? null;
  const created: Tables<"groups">[] = [];
  const errors: { index: number; error: string }[] = [];

  for (const [index, g] of input.groups.entries()) {
    position = midpoint(position, null);
    const { data, error } = await supabase
      .from("groups")
      .insert({
        org_id: board.org_id,
        board_id: input.boardId,
        name: g.name,
        position,
      })
      .select("*")
      .single();
    if (error || !data) {
      errors.push({
        index,
        error: error?.message ?? "Could not create group.",
      });
      continue;
    }
    created.push(data);
  }

  return { ok: true, data: { created, errors } };
}

export async function renameGroupCore(
  supabase: SupabaseClient<Database>,
  input: { groupId: string; name: string },
): Promise<ActionResult> {
  const { data, error } = await supabase
    .from("groups")
    .update({ name: input.name })
    .eq("id", input.groupId)
    .select("board_id")
    .maybeSingle();
  if (error) return fail(error.message);
  if (!data) return fail("Group not found.");
  return { ok: true, data: undefined };
}

export async function reorderGroupCore(
  supabase: SupabaseClient<Database>,
  input: { groupId: string; position: number },
): Promise<ActionResult> {
  const { data, error } = await supabase
    .from("groups")
    .update({ position: input.position })
    .eq("id", input.groupId)
    .select("board_id")
    .maybeSingle();
  if (error) return fail(error.message);
  if (!data) return fail("Group not found.");
  return { ok: true, data: undefined };
}

export async function recolorGroupCore(
  supabase: SupabaseClient<Database>,
  input: { groupId: string; color: string },
): Promise<ActionResult> {
  const { data, error } = await supabase
    .from("groups")
    .update({ color: input.color })
    .eq("id", input.groupId)
    .select("board_id")
    .maybeSingle();
  if (error) return fail(error.message);
  if (!data) return fail("Group not found.");
  return { ok: true, data: undefined };
}

/** Archive a group (+ its live items and their subitems) via the cascade RPC. */
export async function archiveGroupCore(
  supabase: SupabaseClient<Database>,
  input: { groupId: string },
): Promise<ActionResult> {
  const { error } = await supabase.rpc("archive_group", {
    p_group_id: input.groupId,
  });
  if (error) return fail(error.message);
  return { ok: true, data: undefined };
}

/** Restore a group + the items archived in the same batch via RPC. */
export async function restoreGroupCore(
  supabase: SupabaseClient<Database>,
  input: { groupId: string },
): Promise<ActionResult> {
  const { error } = await supabase.rpc("restore_group", {
    p_group_id: input.groupId,
  });
  if (error) return fail(error.message);
  return { ok: true, data: undefined };
}
