"use server";

import { createClient } from "@/lib/supabase/server";
import {
  clearCellSchema,
  upsertCellSchema,
} from "@/lib/validations/board-actions";
import { cellValueSchema } from "@/lib/validations/boards";
import type { Json } from "@/types/database.types";
import { fail, type ActionResult } from "@/lib/actions/result";

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
  return { ok: true, data: undefined };
}
