/**
 * The longest comment the assistant may stage. The confirm card shows one
 * label of at most 500 characters, and a person must be able to read ALL of
 * what will be posted under their name before approving it. The tool itself
 * (and so an MCP client) allows more.
 */
export const ASSISTANT_COMMENT_MAX_CHARS = 300;

/**
 * Calls the assistant refuses for now, with the message the model (and, at
 * Apply, the user) sees. Each `create` entry exists because the underlying
 * tool cannot yet be kept inside the active organisation; see the acceptance
 * notes in docs/superpowers/plans/2026-11-13-unified-assistant-acceptance.md.
 */
export function unsupportedReason(
  tool: string,
  input: Record<string, unknown>,
): string | null {
  if (
    tool === "add_comment" &&
    typeof input.text === "string" &&
    input.text.trim().length > ASSISTANT_COMMENT_MAX_CHARS
  )
    return `Keep a comment to ${ASSISTANT_COMMENT_MAX_CHARS} characters or fewer, so the user can read all of it before confirming.`;
  if (input.action !== "create") return null;
  // The strict create schema needs a workspace, but the loose tool schema
  // the model sees cannot say so; refuse here so the card never offers a
  // change that would only fail at Apply.
  if (
    tool === "manage_board" &&
    (typeof input.workspaceId !== "string" || input.workspaceId === "")
  )
    return "Pass workspaceId: list_boards and get_board return each board's workspaceId. Use the workspace of the board the user is on unless they name another.";
  if (tool === "manage_goal")
    return "Creating goals from the assistant isn't available yet. Create it from the Goals page.";
  if (tool === "manage_portfolio")
    return "Creating portfolios from the assistant isn't available yet. Create it from the Portfolios page.";
  if (
    tool === "manage_dashboard" &&
    input.workspaceId !== undefined &&
    input.workspaceId !== null
  )
    return "Leave out the workspace: a dashboard is created in the current organisation's workspace.";
  return null;
}
