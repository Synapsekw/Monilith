import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database.types";
import { cellValueSchema } from "@/lib/validations/boards";

/**
 * Resolves the per-request, RLS-respecting Supabase client for the authenticated
 * MCP connection. Produced once per tool call in `register.ts`, which closes over
 * `getRequestClient` (`src/lib/mcp/context.ts`).
 *
 * Call it exactly ONCE per handler invocation: each call charges the MCP rate
 * limit and rotates the OAuth bridge secret (`context.ts:39,50-51`). Never call
 * it inside a per-field loop.
 */
export type GetClient = () => Promise<SupabaseClient<Database>>;

/** One field write in `create_item` / `update_item`: a column id plus its raw value. */
export const fieldInput = z.object({
  columnId: z.string().uuid(),
  value: z.record(z.string(), z.unknown()),
});

export type FieldInput = z.infer<typeof fieldInput>;

/**
 * Writes one cell value, mirroring the guard logic in
 * `src/lib/boards/actions/cell.ts`'s `upsertCell`. Returns `null` on success, or
 * a human-readable message the caller surfaces to the agent in `fieldErrors`.
 *
 * Deliberately NOT `upsertCell` itself: that is a cookie-bound `"use server"`
 * action (it calls `createClient()`, which reads `next/headers` cookies), and an
 * MCP request carries only an OAuth bearer token resolved to a bridged client.
 * Calling it here would silently build an unauthenticated client and fail under
 * RLS. See `docs/superpowers/plans/2026-07-24-mcp-server.md` Global Constraints.
 *
 * KNOWN GAP (do not fix here): unlike `upsertCell`, this does not fan out
 * `assigned` notifications when writing a `people` column, so assigning someone
 * via MCP never notifies them. Tracked as finding F1 in
 * `docs/superpowers/specs/2026-07-25-mcp-tools-dedupe-design.md`; the fix is to
 * hoist a client-injected core out of `upsertCell` so both callers share it.
 */
export async function writeCellValue(
  supabase: SupabaseClient<Database>,
  itemId: string,
  field: FieldInput,
): Promise<string | null> {
  const { data: column, error: colErr } = await supabase
    .from("columns")
    .select("org_id, board_id, kind")
    .eq("id", field.columnId)
    .maybeSingle();
  if (colErr || !column) return `Column ${field.columnId} not found.`;

  const { data: item, error: itemErr } = await supabase
    .from("items")
    .select("board_id")
    .eq("id", itemId)
    .maybeSingle();
  if (itemErr || !item) return "Item not found.";
  if (item.board_id !== column.board_id)
    return "Item and column belong to different boards.";

  const valueParsed = cellValueSchema(column.kind).safeParse(field.value);
  if (!valueParsed.success)
    return valueParsed.error.issues[0]?.message ?? "Invalid value.";

  const { error } = await supabase.from("cell_values").upsert(
    {
      org_id: column.org_id,
      board_id: column.board_id,
      item_id: itemId,
      column_id: field.columnId,
      value: valueParsed.data as Json,
    },
    { onConflict: "item_id,column_id" },
  );
  return error?.message ?? null;
}
