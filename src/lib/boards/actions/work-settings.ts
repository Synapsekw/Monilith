"use server";

import * as z from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { fail, type ActionResult } from "@/lib/actions/result";

const schema = z.object({
  boardId: z.uuid(),
  statusColumnId: z.uuid().nullable(),
  doneOptionIds: z.array(z.string().min(1)).min(1).max(50).nullable(),
  dueColumnId: z.uuid().nullable(),
});

/**
 * Which column is the status, which options mean done, which column is the
 * due date (spec 4.2). Null clears a setting back to the live guess. RLS
 * (`boards: update if can edit`) decides who may save. The schema does not
 * enforce that the chosen columns belong to the board or are of the right
 * kind, so this action is the only guard for that.
 */
export async function updateBoardWorkSettings(input: {
  boardId: string;
  statusColumnId: string | null;
  doneOptionIds: string[] | null;
  dueColumnId: string | null;
}): Promise<ActionResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");
  const { boardId, statusColumnId, doneOptionIds, dueColumnId } = parsed.data;

  if (doneOptionIds && !statusColumnId)
    return fail("Choose the status column before its done options.");

  const supabase = await createClient();
  const ids = [statusColumnId, dueColumnId].filter(
    (v): v is string => v !== null,
  );
  const { data: cols, error: colErr } = ids.length
    ? await supabase
        .from("columns")
        .select("id, kind, settings")
        .eq("board_id", boardId)
        .in("id", ids)
    : { data: [], error: null };
  if (colErr) return fail(colErr.message);
  const byId = new Map((cols ?? []).map((c) => [c.id, c]));

  if (statusColumnId) {
    const col = byId.get(statusColumnId);
    if (!col || col.kind !== "status")
      return fail("That status column is not on this board.");
    if (doneOptionIds) {
      const options = (col.settings as { options?: { id?: unknown }[] } | null)
        ?.options;
      const known = new Set(
        Array.isArray(options) ? options.map((o) => String(o.id)) : [],
      );
      if (!doneOptionIds.every((id) => known.has(id)))
        return fail("A done option is not an option of that status column.");
    }
  }
  if (dueColumnId) {
    const col = byId.get(dueColumnId);
    if (!col || col.kind !== "date")
      return fail("The due date must be a date column on this board.");
  }

  const { data, error } = await supabase
    .from("boards")
    .update({
      work_status_column_id: statusColumnId,
      work_done_option_ids: doneOptionIds,
      work_due_column_id: dueColumnId,
    })
    .eq("id", boardId)
    .select("id")
    .maybeSingle();
  if (error) return fail(error.message);
  if (!data) return fail("Board not found, or you cannot edit it.");

  // My Work is the only server-rendered reader of these settings. The board
  // route is deliberately not revalidated: the board view reads from the
  // client cache, and the header overlays the saved values locally.
  revalidatePath("/my-work");
  return { ok: true, data: undefined };
}
