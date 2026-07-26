"use server";

import { createClient } from "@/lib/supabase/server";
import {
  clearCellSchema,
  upsertCellSchema,
} from "@/lib/validations/board-actions";
import { fail, type ActionResult } from "@/lib/actions/result";
import { getUser } from "@/lib/auth/session";
import { upsertCellCore } from "./cell-core";

/**
 * Upsert a single cell value (Server Action). A thin cookie-client wrapper: it
 * owns the untrusted-input Zod boundary and resolves the actor, then delegates
 * every rule — guards, kind validation, the `people` assignment fan-out — to
 * `upsertCellCore`, which the MCP tool layer calls with its own bearer client.
 * Keeping the logic in the core is what stops the two paths from diverging
 * (gotcha-60).
 *
 * The actor comes from `@/lib/auth/session`'s `getUser()` (local JWKS verify,
 * React-cached) rather than `supabase.auth.getUser()` (a GoTrue round-trip) —
 * so a bulk people-assign over N items now costs one local verify, not N calls.
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
  const user = await getUser();
  return upsertCellCore(supabase, parsed.data, user?.id ?? null);
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
