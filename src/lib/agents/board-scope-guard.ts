import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { ToolDescriptor } from "@/lib/mcp/tools/descriptor";
import { resolveItemScope } from "@/lib/collaboration/attachment-core";
import type { BoardScope } from "./agent-config";

/**
 * `board_scope` enforcement for a single tool call.
 *
 * WHAT THIS IS: the owner's stated preference — "this agent only works on these
 * boards" — enforced in the TOOL WRAPPER, not in the prompt. Asking a model
 * nicely to stay on three boards is not enforcement; a refused `execute` is.
 *
 * WHAT THIS IS NOT: a security boundary. Every read and write already runs on a
 * client authenticated as the agent's OWNER, so RLS independently refuses any
 * board the owner cannot see. This guard can only ever narrow that, never widen
 * it — which is also why an unresolvable id is allowed through rather than
 * refused (see `resolveTargetBoardId`).
 */

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
  switch (descriptor.scope) {
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
  }
}

/** Whether a resolved board is one this agent was scoped to. A `null` board is
 *  always in scope — the call addresses no board, so scope cannot refuse it. */
export function isBoardInScope(
  scope: BoardScope,
  boardId: string | null,
): boolean {
  if (boardId === null) return true;
  if (scope.mode === "all") return true;
  return scope.boardIds.includes(boardId);
}
