"use server";

import { createClient } from "@/lib/supabase/server";
import { midpoint } from "@/lib/boards/position";
import {
  createColumnSchema,
  renameColumnSchema,
  deleteColumnSchema,
  resizeColumnSchema,
  reorderColumnSchema,
  resizeNameColumnSchema,
  updateColumnSettingsSchema,
  removeColumnOptionSchema,
} from "@/lib/validations/board-actions";
import type { ColumnKind } from "@/lib/validations/boards";
import { defaultColumn } from "@/lib/boards/column-defaults";
import { columnSettingsSchema } from "@/lib/validations/boards";
import type { Tables } from "@/types/database.types";
import { fail, type ActionResult } from "@/lib/actions/result";

export async function createColumn(input: {
  boardId: string;
  kind: ColumnKind;
  name?: string;
  settings?: Record<string, unknown>;
}): Promise<ActionResult<{ column: Tables<"columns"> }>> {
  const parsed = createColumnSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  // If initial settings were supplied, validate them against the kind's schema
  // (e.g. a relation column must carry a target_board_id). Otherwise default.
  let initialSettings: Record<string, unknown> | null = null;
  if (parsed.data.settings) {
    const settingsParsed = columnSettingsSchema(parsed.data.kind).safeParse(
      parsed.data.settings,
    );
    if (!settingsParsed.success)
      return fail(
        settingsParsed.error.issues[0]?.message ?? "Invalid settings",
      );
    initialSettings = settingsParsed.data as Record<string, unknown>;
  }

  const supabase = await createClient();
  const { data: board, error: boardErr } = await supabase
    .from("boards")
    .select("org_id")
    .eq("id", parsed.data.boardId)
    .maybeSingle();
  if (boardErr || !board) return fail("Board not found.");

  const { data: last } = await supabase
    .from("columns")
    .select("position")
    .eq("board_id", parsed.data.boardId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { name, settings } = defaultColumn(parsed.data.kind, parsed.data.name);

  const { data, error } = await supabase
    .from("columns")
    .insert({
      org_id: board.org_id,
      board_id: parsed.data.boardId,
      kind: parsed.data.kind,
      name,
      settings: (initialSettings ?? settings) as Tables<"columns">["settings"],
      position: midpoint(last?.position ?? null, null),
    })
    .select("*")
    .single();
  if (error || !data) return fail(error?.message ?? "Could not create column.");

  return { ok: true, data: { column: data } };
}

async function columnBoardId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  columnId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("columns")
    .select("board_id")
    .eq("id", columnId)
    .maybeSingle();
  return data?.board_id ?? null;
}

export async function renameColumn(input: {
  columnId: string;
  name: string;
}): Promise<ActionResult> {
  const parsed = renameColumnSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");
  const supabase = await createClient();
  const boardId = await columnBoardId(supabase, parsed.data.columnId);
  if (!boardId) return fail("Column not found.");
  const { error } = await supabase
    .from("columns")
    .update({ name: parsed.data.name })
    .eq("id", parsed.data.columnId);
  if (error) return fail(error.message);
  return { ok: true, data: undefined };
}

export async function resizeColumn(input: {
  columnId: string;
  width: number;
}): Promise<ActionResult> {
  const parsed = resizeColumnSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");
  const supabase = await createClient();
  const boardId = await columnBoardId(supabase, parsed.data.columnId);
  if (!boardId) return fail("Column not found.");
  const { error } = await supabase
    .from("columns")
    .update({ width: parsed.data.width })
    .eq("id", parsed.data.columnId);
  if (error) return fail(error.message);
  return { ok: true, data: undefined };
}

/** Update a column's position (header drag-reorder / Move left-right). */
export async function reorderColumn(input: {
  columnId: string;
  position: number;
}): Promise<ActionResult> {
  const parsed = reorderColumnSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("columns")
    .update({ position: parsed.data.position })
    .eq("id", parsed.data.columnId)
    .select("board_id")
    .maybeSingle();
  if (error) return fail(error.message);
  if (!data) return fail("Column not found.");
  return { ok: true, data: undefined };
}

/**
 * Resize the built-in Name column (per-board). `width: null` clears the manual
 * width so the client falls back to auto-fit. RLS is the boundary; no need to
 * derive the board (the id is the board).
 */
export async function resizeNameColumn(input: {
  boardId: string;
  width: number | null;
}): Promise<ActionResult> {
  const parsed = resizeNameColumnSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");
  const supabase = await createClient();
  const { error } = await supabase
    .from("boards")
    .update({ name_column_width: parsed.data.width })
    .eq("id", parsed.data.boardId);
  if (error) return fail(error.message);
  return { ok: true, data: undefined };
}

/**
 * Replace a column's settings. Validates the incoming settings against the
 * column kind's shape (status/dropdown options, numbers unit/precision, …)
 * before writing. RLS scopes the read + write to the caller's org.
 */
export async function updateColumnSettings(input: {
  columnId: string;
  settings: Record<string, unknown>;
}): Promise<ActionResult> {
  const parsed = updateColumnSettingsSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");
  const supabase = await createClient();
  const { data: col } = await supabase
    .from("columns")
    .select("board_id, kind")
    .eq("id", parsed.data.columnId)
    .maybeSingle();
  if (!col) return fail("Column not found.");
  const shape = columnSettingsSchema(col.kind);
  const settingsParsed = shape.safeParse(parsed.data.settings);
  if (!settingsParsed.success)
    return fail(settingsParsed.error.issues[0]?.message ?? "Invalid settings");
  const { error } = await supabase
    .from("columns")
    .update({ settings: settingsParsed.data as Tables<"columns">["settings"] })
    .eq("id", parsed.data.columnId);
  if (error) return fail(error.message);
  return { ok: true, data: undefined };
}

/**
 * Remove a single option (status/dropdown) from a column's settings AND clear
 * every cell that referenced it, atomically, via the `delete_column_option`
 * RPC. Returns the number of cell rows the server cleared.
 */
export async function removeColumnOption(input: {
  columnId: string;
  optionId: string;
}): Promise<ActionResult<{ clearedCells: number }>> {
  const parsed = removeColumnOptionSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");
  const supabase = await createClient();
  const boardId = await columnBoardId(supabase, parsed.data.columnId);
  if (!boardId) return fail("Column not found.");
  const { data, error } = await supabase.rpc("delete_column_option", {
    p_column_id: parsed.data.columnId,
    p_option_id: parsed.data.optionId,
  });
  if (error) return fail(error.message);
  return { ok: true, data: { clearedCells: data ?? 0 } };
}

export async function deleteColumn(input: {
  columnId: string;
}): Promise<ActionResult> {
  const parsed = deleteColumnSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");
  const supabase = await createClient();
  const boardId = await columnBoardId(supabase, parsed.data.columnId);
  if (!boardId) return fail("Column not found.");
  // cell_values cascade via the column_id FK (on delete cascade).
  const { error } = await supabase
    .from("columns")
    .delete()
    .eq("id", parsed.data.columnId);
  if (error) return fail(error.message);
  return { ok: true, data: undefined };
}
