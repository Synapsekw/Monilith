"use server";

import { createClient } from "@/lib/supabase/server";
import {
  createColumnSchema,
  renameColumnSchema,
  deleteColumnSchema,
  resizeColumnSchema,
  reorderColumnSchema,
  resizeNameColumnSchema,
  resetColumnWidthsSchema,
  updateColumnSettingsSchema,
  removeColumnOptionSchema,
} from "@/lib/validations/board-actions";
import {
  columnSettingsSchema,
  type ColumnKind,
} from "@/lib/validations/boards";
import type { Tables } from "@/types/database.types";
import { fail, type ActionResult } from "@/lib/actions/result";
import {
  createColumnsCore,
  renameColumnCore,
  resizeColumnCore,
  reorderColumnCore,
  updateColumnSettingsCore,
  removeColumnOptionCore,
  deleteColumnCore,
} from "@/lib/boards/core/column";

/**
 * Single-column create — the board UI's contract, unchanged. Delegates to the
 * batch core (`createColumnsCore`) with a one-element array and unwraps the
 * result, so the per-kind settings validation and the single board read live
 * in exactly one place.
 */
export async function createColumn(input: {
  boardId: string;
  kind: ColumnKind;
  name?: string;
  settings?: Record<string, unknown>;
}): Promise<ActionResult<{ column: Tables<"columns"> }>> {
  const parsed = createColumnSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  // Validated here, before any query, so an invalid settings blob never
  // costs a database round-trip — matches the pre-move contract this
  // action's own tests assert on. The core re-validates per entry too (it
  // must, for the batch path), but that happens after a board read.
  if (parsed.data.settings) {
    const settingsParsed = columnSettingsSchema(parsed.data.kind).safeParse(
      parsed.data.settings,
    );
    if (!settingsParsed.success)
      return fail(
        settingsParsed.error.issues[0]?.message ?? "Invalid settings",
      );
  }

  const { boardId, ...column } = parsed.data;
  const r = await createColumnsCore(await createClient(), {
    boardId,
    columns: [column],
  });
  if (!r.ok) return r;
  const first = r.data.created[0];
  if (!first)
    return fail(r.data.errors[0]?.error ?? "Could not create column.");
  return { ok: true, data: { column: first } };
}

export async function renameColumn(input: {
  columnId: string;
  name: string;
}): Promise<ActionResult> {
  const parsed = renameColumnSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");
  return renameColumnCore(await createClient(), parsed.data);
}

/** Persist a dragged column width, or clear it with `width: null` so the client auto-fits the column again. */
export async function resizeColumn(input: {
  columnId: string;
  width: number | null;
}): Promise<ActionResult> {
  const parsed = resizeColumnSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");
  return resizeColumnCore(await createClient(), parsed.data);
}

/** Update a column's position (header drag-reorder / Move left-right). */
export async function reorderColumn(input: {
  columnId: string;
  position: number;
}): Promise<ActionResult> {
  const parsed = reorderColumnSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");
  return reorderColumnCore(await createClient(), parsed.data);
}

/**
 * Resize the built-in Name column (per-board). `width: null` clears the manual
 * width so the client falls back to auto-fit. RLS is the boundary; no need to
 * derive the board (the id is the board).
 *
 * Writes to `boards`, not `columns` — no core, no MCP tool action.
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
 * "Fit all columns": clear every saved column width on a board AND the saved
 * Name width, so the whole table returns to auto-fit. One action, two
 * RLS-scoped writes, no revalidation (the caller patches its cache
 * optimistically, like `resizeNameColumn`).
 *
 * The board write goes first and reads its row back. Under RLS an update the
 * caller may not make (a viewer, or a board in another org) matches no row and
 * returns no data rather than an error, so `data === null` is the fail-closed
 * signal — the same shape as `reorderColumnCore`. Only then are the board's
 * columns cleared (`columns_board_id_idx`).
 *
 * Writes to `boards` as well as `columns`, and has no MCP tool action — so it
 * lives here beside `resizeNameColumn`, not in the core.
 */
export async function resetColumnWidths(input: {
  boardId: string;
}): Promise<ActionResult> {
  const parsed = resetColumnWidthsSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");
  const supabase = await createClient();
  const { data: board, error: boardError } = await supabase
    .from("boards")
    .update({ name_column_width: null })
    .eq("id", parsed.data.boardId)
    .select("id")
    .maybeSingle();
  if (boardError) return fail(boardError.message);
  if (!board) return fail("Board not found.");
  const { error } = await supabase
    .from("columns")
    .update({ width: null })
    .eq("board_id", parsed.data.boardId);
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
  return updateColumnSettingsCore(await createClient(), parsed.data);
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
  return removeColumnOptionCore(await createClient(), parsed.data);
}

export async function deleteColumn(input: {
  columnId: string;
}): Promise<ActionResult> {
  const parsed = deleteColumnSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");
  return deleteColumnCore(await createClient(), parsed.data);
}
