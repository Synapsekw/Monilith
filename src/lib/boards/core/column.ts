import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/types/database.types";
import { fail, type ActionResult } from "@/lib/actions/result";
import { midpoint } from "@/lib/boards/position";
import { defaultColumn } from "@/lib/boards/column-defaults";
import {
  columnSettingsSchema,
  type ColumnKind,
} from "@/lib/validations/boards";
import type { BatchResult } from "./batch";

/**
 * Batched column create — the core `createColumn` (the Server Action) and
 * `manage_column`'s `create` action both delegate to.
 *
 * The board is read ONCE, before the loop, and its `org_id` is reused for
 * every insert — an N-query read here (one `boards` probe per column) is
 * the most likely performance defect in a multi-column batch.
 *
 * Per-kind settings validation is preserved from the pre-move `createColumn`:
 * a relation column with no `target_board_id` is rejected here rather than
 * written and exploding on the board page later. A failed entry is a
 * per-index error in the returned batch, not an aborted batch — the rest of
 * the columns still get created.
 */
export async function createColumnsCore(
  supabase: SupabaseClient<Database>,
  input: {
    boardId: string;
    columns: {
      kind: ColumnKind;
      name?: string;
      settings?: Record<string, unknown>;
    }[];
  },
): Promise<ActionResult<BatchResult<Tables<"columns">>>> {
  const { data: board, error: boardErr } = await supabase
    .from("boards")
    .select("org_id")
    .eq("id", input.boardId)
    .maybeSingle();
  if (boardErr || !board) return fail("Board not found.");

  const { data: last } = await supabase
    .from("columns")
    .select("position")
    .eq("board_id", input.boardId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  let position = last?.position ?? null;
  const created: Tables<"columns">[] = [];
  const errors: { index: number; error: string }[] = [];

  for (const [index, c] of input.columns.entries()) {
    // Per-kind validation, kept from createColumn: a relation column must
    // carry target_board_id, a status column's options must parse. Writing an
    // unvalidated blob here surfaces as a crash on the board page later.
    let initialSettings: Record<string, unknown> | null = null;
    if (c.settings) {
      const settingsParsed = columnSettingsSchema(c.kind).safeParse(c.settings);
      if (!settingsParsed.success) {
        errors.push({
          index,
          error: settingsParsed.error.issues[0]?.message ?? "Invalid settings",
        });
        continue;
      }
      initialSettings = settingsParsed.data as Record<string, unknown>;
    }

    const { name, settings } = defaultColumn(c.kind, c.name);
    position = midpoint(position, null);
    const { data, error } = await supabase
      .from("columns")
      .insert({
        org_id: board.org_id,
        board_id: input.boardId,
        kind: c.kind,
        name,
        settings: (initialSettings ??
          settings) as Tables<"columns">["settings"],
        position,
      })
      .select("*")
      .single();
    if (error || !data) {
      errors.push({
        index,
        error: error?.message ?? "Could not create column.",
      });
      continue;
    }
    created.push(data);
  }

  return { ok: true, data: { created, errors } };
}

async function columnBoardId(
  supabase: SupabaseClient<Database>,
  columnId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("columns")
    .select("board_id")
    .eq("id", columnId)
    .maybeSingle();
  return data?.board_id ?? null;
}

export async function renameColumnCore(
  supabase: SupabaseClient<Database>,
  input: { columnId: string; name: string },
): Promise<ActionResult> {
  const boardId = await columnBoardId(supabase, input.columnId);
  if (!boardId) return fail("Column not found.");
  const { error } = await supabase
    .from("columns")
    .update({ name: input.name })
    .eq("id", input.columnId);
  if (error) return fail(error.message);
  return { ok: true, data: undefined };
}

export async function resizeColumnCore(
  supabase: SupabaseClient<Database>,
  input: { columnId: string; width: number },
): Promise<ActionResult> {
  const boardId = await columnBoardId(supabase, input.columnId);
  if (!boardId) return fail("Column not found.");
  const { error } = await supabase
    .from("columns")
    .update({ width: input.width })
    .eq("id", input.columnId);
  if (error) return fail(error.message);
  return { ok: true, data: undefined };
}

/** Update a column's position (header drag-reorder / Move left-right). */
export async function reorderColumnCore(
  supabase: SupabaseClient<Database>,
  input: { columnId: string; position: number },
): Promise<ActionResult> {
  const { data, error } = await supabase
    .from("columns")
    .update({ position: input.position })
    .eq("id", input.columnId)
    .select("board_id")
    .maybeSingle();
  if (error) return fail(error.message);
  if (!data) return fail("Column not found.");
  return { ok: true, data: undefined };
}

/**
 * Replace a column's settings. Validates the incoming settings against the
 * column kind's shape (status/dropdown options, numbers unit/precision, …)
 * before writing. RLS scopes the read + write to the caller's org.
 */
export async function updateColumnSettingsCore(
  supabase: SupabaseClient<Database>,
  input: { columnId: string; settings: Record<string, unknown> },
): Promise<ActionResult> {
  const { data: col } = await supabase
    .from("columns")
    .select("board_id, kind")
    .eq("id", input.columnId)
    .maybeSingle();
  if (!col) return fail("Column not found.");
  const shape = columnSettingsSchema(col.kind);
  const settingsParsed = shape.safeParse(input.settings);
  if (!settingsParsed.success)
    return fail(settingsParsed.error.issues[0]?.message ?? "Invalid settings");
  const { error } = await supabase
    .from("columns")
    .update({ settings: settingsParsed.data as Tables<"columns">["settings"] })
    .eq("id", input.columnId);
  if (error) return fail(error.message);
  return { ok: true, data: undefined };
}

/**
 * Remove a single option (status/dropdown) from a column's settings AND clear
 * every cell that referenced it, atomically, via the `delete_column_option`
 * RPC. Returns the number of cell rows the server cleared.
 */
export async function removeColumnOptionCore(
  supabase: SupabaseClient<Database>,
  input: { columnId: string; optionId: string },
): Promise<ActionResult<{ clearedCells: number }>> {
  const boardId = await columnBoardId(supabase, input.columnId);
  if (!boardId) return fail("Column not found.");
  const { data, error } = await supabase.rpc("delete_column_option", {
    p_column_id: input.columnId,
    p_option_id: input.optionId,
  });
  if (error) return fail(error.message);
  return { ok: true, data: { clearedCells: data ?? 0 } };
}

export async function deleteColumnCore(
  supabase: SupabaseClient<Database>,
  input: { columnId: string },
): Promise<ActionResult> {
  const boardId = await columnBoardId(supabase, input.columnId);
  if (!boardId) return fail("Column not found.");
  // cell_values cascade via the column_id FK (on delete cascade).
  const { error } = await supabase
    .from("columns")
    .delete()
    .eq("id", input.columnId);
  if (error) return fail(error.message);
  return { ok: true, data: undefined };
}
