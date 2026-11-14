import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { scopeFor, type ToolDescriptor } from "@/lib/mcp/tools/descriptor";
import { resolveItemScope } from "@/lib/collaboration/attachment-core";

/**
 * Which board a call addresses, or `null` when it addresses none.
 *
 * `null` covers three distinct cases, all of which mean "board scope has
 * nothing to say here":
 *   - `scope: "none"` tools (`get_report`, `get_dashboard`, `get_portfolio`,
 *     `get_widget_data`, `list_boards`, …). They reach board-derived data
 *     through non-board ids that span many boards; resolving them was rejected
 *     deliberately (see `descriptor.ts`), so RLS is their sole boundary.
 *   - an OPTIONAL id that was omitted — `log_time_allocation` is `scope:
 *     "itemId"` but may log against a category instead, addressing no item.
 *   - an id the OWNER cannot see. The lookup runs on the owner's client, so a
 *     resolution can never reveal a board the owner has no access to; the call
 *     proceeds and RLS refuses it inside the handler, which is the correct
 *     boundary to fail at.
 */
export async function resolveTargetBoardId(
  client: SupabaseClient<Database>,
  descriptor: ToolDescriptor,
  input: Record<string, unknown>,
): Promise<string | null> {
  switch (scopeFor(descriptor, input)) {
    case "none":
      return null;
    case "boardId":
      return typeof input.boardId === "string" ? input.boardId : null;
    case "itemId": {
      if (typeof input.itemId !== "string") return null;
      // The same RLS-scoped item→org/board read the attachment path uses —
      // one canonical resolver, not a second copy that could drift.
      const scope = await resolveItemScope(client, input.itemId);
      return scope?.boardId ?? null;
    }
    case "groupId": {
      if (typeof input.groupId !== "string") return null;
      const { data } = await client
        .from("groups")
        .select("board_id")
        .eq("id", input.groupId)
        .maybeSingle();
      return data?.board_id ?? null;
    }
    // Each of the three below is ONE indexed probe on a primary key, the same
    // shape as the groupId branch. Never a scan.
    case "columnId": {
      if (typeof input.columnId !== "string") return null;
      const { data } = await client
        .from("columns")
        .select("board_id")
        .eq("id", input.columnId)
        .maybeSingle();
      return data?.board_id ?? null;
    }
    case "viewId": {
      if (typeof input.viewId !== "string") return null;
      const { data } = await client
        .from("board_views")
        .select("board_id")
        .eq("id", input.viewId)
        .maybeSingle();
      return data?.board_id ?? null;
    }
    case "automationId": {
      if (typeof input.automationId !== "string") return null;
      const { data } = await client
        .from("automations")
        .select("board_id")
        .eq("id", input.automationId)
        .maybeSingle();
      return data?.board_id ?? null;
    }
  }
}
