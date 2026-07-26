import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cellValueSchema } from "@/lib/validations/boards";
import { fail, type ActionResult } from "@/lib/actions/result";
import type { Database, Json } from "@/types/database.types";

/** What a cell write needs, already parsed by the caller's own Zod boundary. */
export type UpsertCellCoreInput = {
  itemId: string;
  columnId: string;
  value: unknown;
};

/**
 * The single implementation of "write one cell value" for the whole app:
 * derives org_id/board_id from the parent column, guards item/column board
 * integrity, validates the value against the column kind, upserts, and — for a
 * `people` column — fans out `kind: "assigned"` notifications to the
 * newly-added members.
 *
 * Both the Supabase client AND the actor are injected, which is the entire
 * point: a cookie-bound Server Action and a bearer-token MCP request produce
 * different clients and resolve their user differently, but must produce
 * identical side effects. This function therefore NEVER calls `supabase.auth.*`
 * — see `vault/decisions/2026-07-25-gotcha-60-server-action-side-effects-invisible-to-mcp.md`
 * and spec §3.1 (`docs/superpowers/specs/2026-07-26-mcp-assigned-notification-design.md`).
 *
 * Callers: `upsertCell` (`./cell.ts`, cookie client) and `writeCellValue`
 * (`src/lib/mcp/tools/shared.ts`, bridged OAuth client).
 */
export async function upsertCellCore(
  supabase: SupabaseClient<Database>,
  input: UpsertCellCoreInput,
  actorId: string | null,
): Promise<ActionResult> {
  // Derive org_id/board_id + kind from the parent column (RLS-scoped read).
  const { data: column, error: colErr } = await supabase
    .from("columns")
    .select("org_id, board_id, kind")
    .eq("id", input.columnId)
    .maybeSingle();
  if (colErr || !column) return fail("Column not found.");

  // Within-org integrity guard: item must belong to the same board as the column.
  const { data: item, error: itemErr } = await supabase
    .from("items")
    .select("board_id")
    .eq("id", input.itemId)
    .maybeSingle();
  if (itemErr || !item) return fail("Item not found.");
  if (item.board_id !== column.board_id)
    return fail("Item and column belong to different boards.");

  // Validate the value against the column kind's shape.
  const valueParsed = cellValueSchema(column.kind).safeParse(input.value);
  if (!valueParsed.success)
    return fail(valueParsed.error.issues[0]?.message ?? "Invalid value");

  // For People cells, read the prior assignees so we can fan out 'assigned'
  // notifications to only the newly-added members after the write.
  let priorPeople: string[] = [];
  if (column.kind === "people") {
    const { data: prior } = await supabase
      .from("cell_values")
      .select("value")
      .eq("item_id", input.itemId)
      .eq("column_id", input.columnId)
      .maybeSingle();
    priorPeople =
      (prior?.value as { userIds?: string[] } | null)?.userIds ?? [];
  }

  const { error } = await supabase.from("cell_values").upsert(
    {
      org_id: column.org_id,
      board_id: column.board_id,
      item_id: input.itemId,
      column_id: input.columnId,
      value: valueParsed.data as Json,
    },
    { onConflict: "item_id,column_id" },
  );
  if (error) return fail(error.message);

  if (column.kind === "people") {
    const next = (valueParsed.data as { userIds?: string[] }).userIds ?? [];
    const added = next.filter(
      (id) => !priorPeople.includes(id) && id !== actorId,
    );
    if (added.length > 0) {
      // Best-effort fan-out: the cell write already succeeded, so never fail the
      // caller — but never drop the failure silently either (spec F3 / decision D4).
      let notifError: string | undefined;
      if (!actorId) {
        // A null actor cannot satisfy the `actor_id = auth.uid()` insert policy,
        // so log it instead of paying a round-trip to be told so.
        notifError = "no actor";
      } else {
        const { error: notifErr } = await supabase.from("notifications").insert(
          added.map((rid) => ({
            org_id: column.org_id,
            recipient_id: rid,
            actor_id: actorId,
            kind: "assigned" as const,
            board_id: column.board_id,
            item_id: input.itemId,
          })),
        );
        notifError = notifErr?.message;
      }
      if (notifError)
        console.error("[notifications] assigned fan-out failed", {
          itemId: input.itemId,
          recipients: added.length,
          error: notifError,
        });
    }
  }
  return { ok: true, data: undefined };
}
