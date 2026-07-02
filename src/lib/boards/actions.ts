"use server";

import { revalidatePath, updateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth/session";
import { boardsTag } from "@/lib/cache/tags";
import { midpoint } from "@/lib/boards/position";
import {
  clearCellSchema,
  createBoardSchema,
  createBoardFromTemplateSchema,
  createGroupSchema,
  createItemSchema,
  deleteBoardSchema,
  duplicateBoardSchema,
  deleteGroupSchema,
  renameBoardSchema,
  renameGroupSchema,
  reorderBoardSchema,
  reorderGroupSchema,
  updateGroupColorSchema,
  renameItemSchema,
  upsertCellSchema,
  createColumnSchema,
  renameColumnSchema,
  deleteColumnSchema,
  resizeColumnSchema,
  resizeNameColumnSchema,
  addSubitemSchema,
  deleteItemSchema,
  reorderItemSchema,
  updateColumnSettingsSchema,
  removeColumnOptionSchema,
} from "@/lib/validations/board-actions";
import { removeAttachmentObjects } from "@/lib/collaboration/attachment-cleanup";
import { getBoardAccess } from "@/lib/boards/queries";
import { getTemplate } from "@/lib/boards/templates";
import { buildTemplatePayload } from "@/lib/boards/template-payload";
import type { ColumnKind } from "@/lib/validations/boards";
import { defaultColumn } from "@/lib/boards/column-defaults";
import {
  cellValueSchema,
  columnSettingsSchema,
} from "@/lib/validations/boards";
import type { Json, Tables } from "@/types/database.types";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

function fail(message: string): { ok: false; error: string } {
  return { ok: false, error: message };
}

/**
 * Invalidate the current user's cached `boards:user:<me>` list
 * (read-your-own-writes). Board-list mutations are owner-scoped
 * (`created_by = me`), so the owner is the current session user.
 */
async function invalidateMyBoards(): Promise<void> {
  const user = await getUser();
  if (user) updateTag(boardsTag(user.id));
}

/** Create a board pre-populated from a built-in template via an atomic RPC. */
export async function createBoardFromTemplate(input: {
  workspaceId: string;
  templateId: string;
  name: string;
}): Promise<ActionResult<{ boardId: string }>> {
  const parsed = createBoardFromTemplateSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const template = getTemplate(parsed.data.templateId);
  if (!template) return fail("Unknown template.");

  const payload = buildTemplatePayload(template);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_board_from_template", {
    p_workspace_id: parsed.data.workspaceId,
    p_name: parsed.data.name,
    p_template: payload as unknown as Json,
  });
  if (error || !data) return fail(error?.message ?? "Could not create board.");

  await invalidateMyBoards();
  return { ok: true, data: { boardId: data.id } };
}

/** Create a board with auto-seeded Group 1 + Status/Owner/Date via RPC. */
export async function createBoard(input: {
  workspaceId: string;
  name: string;
}): Promise<ActionResult<{ boardId: string }>> {
  const parsed = createBoardSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_board", {
    p_workspace_id: parsed.data.workspaceId,
    p_name: parsed.data.name,
  });
  if (error || !data) return fail(error?.message ?? "Could not create board.");

  await invalidateMyBoards();
  return { ok: true, data: { boardId: data.id } };
}

export async function renameBoard(input: {
  boardId: string;
  name: string;
}): Promise<ActionResult> {
  const parsed = renameBoardSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const { error } = await supabase
    .from("boards")
    .update({ name: parsed.data.name })
    .eq("id", parsed.data.boardId);
  if (error) return fail(error.message);

  await invalidateMyBoards();
  // The board name shows on the board page's own (uncached) header; the sidebar
  // list is served from the `boards:user:<me>` cache the updateTag above expired.
  revalidatePath(`/boards/${parsed.data.boardId}`);
  return { ok: true, data: undefined };
}

/**
 * Reorder a board in the current user's own sidebar list. `position` is a float
 * (midpoint strategy) computed client-side. Scoped to `created_by = me`: a user
 * can only reorder boards they own, and that column is read only by the owner —
 * so the order is personal per-user with no shared-order side effects.
 */
export async function reorderBoard(input: {
  boardId: string;
  position: number;
}): Promise<ActionResult> {
  const parsed = reorderBoardSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("Not authenticated.");

  const { data, error } = await supabase
    .from("boards")
    .update({ position: parsed.data.position })
    .eq("id", parsed.data.boardId)
    .eq("created_by", user.id)
    .select("id")
    .maybeSingle();
  if (error) return fail(error.message);
  if (!data) return fail("Board not found.");

  // No revalidate: the sidebar shows the new order optimistically and the
  // position is persisted, so a fresh load reads it back. Busting the shared
  // (app) layout here would reload the whole sidebar on the next navigation
  // (gotcha-44). create/rename/delete still revalidate — they change the list
  // membership/labels the optimistic state can't cover on its own.
  return { ok: true, data: undefined };
}

export async function deleteBoard(input: {
  boardId: string;
}): Promise<ActionResult> {
  const parsed = deleteBoardSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  // Defense in depth: RLS already blocks non-owners, but an RLS-filtered
  // delete affects 0 rows and returns no error — a lying success. Check
  // explicitly so non-owners get a real answer (spec F4 / decision D5).
  const access = await getBoardAccess(parsed.data.boardId);
  if (access !== "owner")
    return fail("Only the board owner can delete this board.");

  const supabase = await createClient();

  // Attachment rows cascade with the board; their Storage objects do not. Every
  // attachment carries a denormalized board_id, so one query covers all items.
  const { data: attachments } = await supabase
    .from("attachments")
    .select("storage_path")
    .eq("board_id", parsed.data.boardId);

  const { error } = await supabase
    .from("boards")
    .delete()
    .eq("id", parsed.data.boardId);
  if (error) return fail(error.message);

  await removeAttachmentObjects((attachments ?? []).map((a) => a.storage_path));

  await invalidateMyBoards();
  return { ok: true, data: undefined };
}

/** Duplicate a board's full structure (groups, columns, items, cells) via RPC. */
export async function duplicateBoard(input: {
  boardId: string;
}): Promise<ActionResult<{ boardId: string }>> {
  const parsed = duplicateBoardSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  // Any member (owner/editor/viewer) may duplicate — they can already read
  // the data. Non-members get the same message as a missing board so we
  // don't leak existence (spec F4 / decision D5).
  const access = await getBoardAccess(parsed.data.boardId);
  if (!access) return fail("Board not found.");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("duplicate_board_structure", {
    p_board_id: parsed.data.boardId,
  });
  if (error || !data)
    return fail(error?.message ?? "Could not duplicate board.");

  await invalidateMyBoards();
  return { ok: true, data: { boardId: data.id } };
}

export async function renameGroup(input: {
  groupId: string;
  name: string;
}): Promise<ActionResult> {
  const parsed = renameGroupSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("groups")
    .update({ name: parsed.data.name })
    .eq("id", parsed.data.groupId)
    .select("board_id")
    .maybeSingle();
  if (error) return fail(error.message);
  if (!data) return fail("Group not found.");

  revalidatePath(`/boards/${data.board_id}`);
  return { ok: true, data: undefined };
}

export async function createGroup(input: {
  boardId: string;
  name: string;
}): Promise<ActionResult<{ group: Tables<"groups"> }>> {
  const parsed = createGroupSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();

  // org_id is denormalized — read it from the board, then derive a position.
  const { data: board, error: boardErr } = await supabase
    .from("boards")
    .select("org_id")
    .eq("id", parsed.data.boardId)
    .maybeSingle();
  if (boardErr || !board) return fail("Board not found.");

  const { data: last } = await supabase
    .from("groups")
    .select("position")
    .eq("board_id", parsed.data.boardId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await supabase
    .from("groups")
    .insert({
      org_id: board.org_id,
      board_id: parsed.data.boardId,
      name: parsed.data.name,
      position: midpoint(last?.position ?? null, null),
    })
    .select("*")
    .single();
  if (error || !data) return fail(error?.message ?? "Could not create group.");

  revalidatePath(`/boards/${parsed.data.boardId}`);
  return { ok: true, data: { group: data } };
}

export async function reorderGroup(input: {
  groupId: string;
  position: number;
}): Promise<ActionResult> {
  const parsed = reorderGroupSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("groups")
    .update({ position: parsed.data.position })
    .eq("id", parsed.data.groupId)
    .select("board_id")
    .maybeSingle();
  if (error) return fail(error.message);
  if (!data) return fail("Group not found.");

  revalidatePath(`/boards/${data.board_id}`);
  return { ok: true, data: undefined };
}

export async function updateGroupColor(input: {
  groupId: string;
  color: string;
}): Promise<ActionResult> {
  const parsed = updateGroupColorSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("groups")
    .update({ color: parsed.data.color })
    .eq("id", parsed.data.groupId)
    .select("board_id")
    .maybeSingle();
  if (error) return fail(error.message);
  if (!data) return fail("Group not found.");

  revalidatePath(`/boards/${data.board_id}`);
  return { ok: true, data: undefined };
}

export async function deleteGroup(input: {
  groupId: string;
}): Promise<ActionResult> {
  const parsed = deleteGroupSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  // items cascade via the group_id FK (on delete cascade).
  const { data, error } = await supabase
    .from("groups")
    .delete()
    .eq("id", parsed.data.groupId)
    .select("board_id")
    .maybeSingle();
  if (error) return fail(error.message);
  if (!data) return fail("Group not found.");

  revalidatePath(`/boards/${data.board_id}`);
  return { ok: true, data: undefined };
}

/** Create an item via RPC (server derives org_id/board_id and position). Returns the full created item row. */
export async function createItem(input: {
  groupId: string;
  name: string;
}): Promise<ActionResult<{ item: Tables<"items"> }>> {
  const parsed = createItemSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_item", {
    p_group_id: parsed.data.groupId,
    p_name: parsed.data.name,
  });
  if (error || !data) return fail(error?.message ?? "Could not create item.");

  revalidatePath(`/boards/${data.board_id}`);
  return { ok: true, data: { item: data as Tables<"items"> } };
}

export async function renameItem(input: {
  itemId: string;
  name: string;
}): Promise<ActionResult> {
  const parsed = renameItemSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("items")
    .update({ name: parsed.data.name })
    .eq("id", parsed.data.itemId)
    .select("board_id")
    .maybeSingle();
  if (error) return fail(error.message);
  // maybeSingle() returns null data with no error when the item is missing or
  // hidden by RLS — treat that as a failure rather than a silent no-op success.
  if (!data) return fail("Item not found.");
  revalidatePath(`/boards/${data.board_id}`);
  return { ok: true, data: undefined };
}

/** Create a subitem under a top-level parent. Derives org/board/group from the
 *  parent (RLS-scoped); the DB trigger enforces the single-level invariant. */
export async function addSubitem(input: {
  parentId: string;
  name: string;
}): Promise<ActionResult<{ item: Tables<"items"> }>> {
  const parsed = addSubitemSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();

  const { data: parent, error: parentErr } = await supabase
    .from("items")
    .select("org_id, board_id, group_id, parent_id")
    .eq("id", parsed.data.parentId)
    .maybeSingle();
  if (parentErr || !parent) return fail("Parent item not found.");
  if (parent.parent_id !== null) return fail("Subitems cannot be nested.");

  const { data: last } = await supabase
    .from("items")
    .select("position")
    .eq("parent_id", parsed.data.parentId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await supabase
    .from("items")
    .insert({
      org_id: parent.org_id,
      board_id: parent.board_id,
      group_id: parent.group_id,
      parent_id: parsed.data.parentId,
      name: parsed.data.name,
      position: midpoint(last?.position ?? null, null),
    })
    .select("*")
    .single();
  if (error || !data)
    return fail(error?.message ?? "Could not create subitem.");

  revalidatePath(`/boards/${parent.board_id}`);
  return { ok: true, data: { item: data } };
}

/**
 * Delete an item (or subitem). Subitems, cell values, and attachment *rows*
 * cascade via FKs; the underlying Storage objects do not, so gather their paths
 * (item + its subitems) before the cascade removes the rows, then free them
 * after the delete succeeds. See removeAttachmentObjects for why this needs the
 * service-role client.
 */
export async function deleteItem(input: {
  itemId: string;
}): Promise<ActionResult> {
  const parsed = deleteItemSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();

  const { data: subitems } = await supabase
    .from("items")
    .select("id")
    .eq("parent_id", parsed.data.itemId);
  const itemIds = [parsed.data.itemId, ...(subitems ?? []).map((s) => s.id)];
  const { data: attachments } = await supabase
    .from("attachments")
    .select("storage_path")
    .in("item_id", itemIds);

  const { data, error } = await supabase
    .from("items")
    .delete()
    .eq("id", parsed.data.itemId)
    .select("board_id")
    .maybeSingle();
  if (error) return fail(error.message);
  if (!data) return fail("Item not found.");

  await removeAttachmentObjects((attachments ?? []).map((a) => a.storage_path));

  revalidatePath(`/boards/${data.board_id}`);
  return { ok: true, data: undefined };
}

/** Update an item's position (subitem reorder within a parent). */
export async function reorderItem(input: {
  itemId: string;
  position: number;
}): Promise<ActionResult> {
  const parsed = reorderItemSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("items")
    .update({ position: parsed.data.position })
    .eq("id", parsed.data.itemId)
    .select("board_id")
    .maybeSingle();
  if (error) return fail(error.message);
  if (!data) return fail("Item not found.");

  revalidatePath(`/boards/${data.board_id}`);
  return { ok: true, data: undefined };
}

/**
 * Upsert a single cell value. Derives org_id/board_id server-side from the
 * parent column (the client never supplies them) and validates the value
 * against the column kind's schema before writing. Conflict target is the
 * (item_id, column_id) primary key.
 */
export async function upsertCell(input: {
  itemId: string;
  columnId: string;
  value: unknown;
}): Promise<ActionResult> {
  const parsed = upsertCellSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();

  // Derive org_id/board_id + kind from the parent column (RLS-scoped read).
  const { data: column, error: colErr } = await supabase
    .from("columns")
    .select("org_id, board_id, kind")
    .eq("id", parsed.data.columnId)
    .maybeSingle();
  if (colErr || !column) return fail("Column not found.");

  // Within-org integrity guard: item must belong to the same board as the column.
  const { data: item, error: itemErr } = await supabase
    .from("items")
    .select("board_id")
    .eq("id", parsed.data.itemId)
    .maybeSingle();
  if (itemErr || !item) return fail("Item not found.");
  if (item.board_id !== column.board_id)
    return fail("Item and column belong to different boards.");

  // Validate the value against the column kind's shape.
  const valueParsed = cellValueSchema(column.kind).safeParse(parsed.data.value);
  if (!valueParsed.success)
    return fail(valueParsed.error.issues[0]?.message ?? "Invalid value");

  // For People cells, read the prior assignees so we can fan out 'assigned'
  // notifications to only the newly-added members after the write.
  let priorPeople: string[] = [];
  if (column.kind === "people") {
    const { data: prior } = await supabase
      .from("cell_values")
      .select("value")
      .eq("item_id", parsed.data.itemId)
      .eq("column_id", parsed.data.columnId)
      .maybeSingle();
    priorPeople =
      (prior?.value as { userIds?: string[] } | null)?.userIds ?? [];
  }

  const { error } = await supabase.from("cell_values").upsert(
    {
      org_id: column.org_id,
      board_id: column.board_id,
      item_id: parsed.data.itemId,
      column_id: parsed.data.columnId,
      value: valueParsed.data as Json,
    },
    { onConflict: "item_id,column_id" },
  );
  if (error) return fail(error.message);

  if (column.kind === "people") {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const next = (valueParsed.data as { userIds?: string[] }).userIds ?? [];
    const added = next.filter(
      (id) => !priorPeople.includes(id) && id !== user?.id,
    );
    if (added.length > 0) {
      const { error: notifErr } = await supabase.from("notifications").insert(
        added.map((rid) => ({
          org_id: column.org_id,
          recipient_id: rid,
          actor_id: user?.id ?? null,
          kind: "assigned" as const,
          board_id: column.board_id,
          item_id: parsed.data.itemId,
        })),
      );
      // Best-effort fan-out: the cell write already succeeded, so don't fail
      // the action — but never drop the failure silently (spec F3 / decision D4).
      if (notifErr)
        console.error("[notifications] assigned fan-out failed", {
          itemId: parsed.data.itemId,
          recipients: added.length,
          error: notifErr.message,
        });
    }
  }

  revalidatePath(`/boards/${column.board_id}`);
  return { ok: true, data: undefined };
}

/** Clear a cell (delete the row — a missing row is an empty cell). */
export async function clearCell(input: {
  itemId: string;
  columnId: string;
}): Promise<ActionResult> {
  const parsed = clearCellSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();

  const { data: column, error: colErr } = await supabase
    .from("columns")
    .select("board_id")
    .eq("id", parsed.data.columnId)
    .maybeSingle();
  if (colErr || !column) return fail("Column not found.");

  const { error } = await supabase
    .from("cell_values")
    .delete()
    .eq("item_id", parsed.data.itemId)
    .eq("column_id", parsed.data.columnId);
  if (error) return fail(error.message);

  revalidatePath(`/boards/${column.board_id}`);
  return { ok: true, data: undefined };
}

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

  revalidatePath(`/boards/${parsed.data.boardId}`);
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
  revalidatePath(`/boards/${boardId}`);
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
  revalidatePath(`/boards/${boardId}`);
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
  revalidatePath(`/boards/${parsed.data.boardId}`);
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
  revalidatePath(`/boards/${col.board_id}`);
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
  revalidatePath(`/boards/${boardId}`);
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
  revalidatePath(`/boards/${boardId}`);
  return { ok: true, data: undefined };
}
