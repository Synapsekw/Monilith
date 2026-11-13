import "server-only";
import type { ToolDescriptor } from "@/lib/mcp/tools/descriptor";
import type { BoardScope } from "./agent-config";

export { resolveTargetBoardId } from "@/lib/assistant/target-board";

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

/**
 * Whether this call is a create that a NARROWED agent may not make.
 *
 * `board_scope` narrows board-ADDRESSED calls. A create addresses no existing
 * board, so ordinary scope resolution has nothing to catch it on: an agent
 * scoped to boards A and B could create board C and then be unable to touch
 * it. This closes that, and closes it by REFUSING rather than by widening the
 * agent's scope — an agent that edits its own permission config is an
 * escalation primitive a prompt injection can drive one board at a time.
 */
export function refusesUnscopedCreate(
  descriptor: ToolDescriptor,
  scope: BoardScope,
  input: Record<string, unknown>,
): boolean {
  if (scope.mode === "all") return false;
  const actions = descriptor.unscopedCreateActions;
  if (!actions || actions.length === 0) return false;
  return typeof input.action === "string" && actions.includes(input.action);
}
