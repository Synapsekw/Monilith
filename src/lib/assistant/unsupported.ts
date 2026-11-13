/**
 * Calls the assistant refuses for now, with the message the model (and, at
 * Apply, the user) sees. Each entry exists because the underlying tool cannot
 * yet be kept inside the active organisation; see the acceptance notes in
 * docs/superpowers/plans/2026-11-13-unified-assistant-acceptance.md.
 */
export function unsupportedReason(
  tool: string,
  input: Record<string, unknown>,
): string | null {
  if (input.action !== "create") return null;
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
