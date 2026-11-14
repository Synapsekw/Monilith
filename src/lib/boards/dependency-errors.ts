/**
 * User copy for `create_item_dependency` failures. The RPC raises terse,
 * lowercase Postgres messages (see 20261113190536_cross_board_dependencies.sql);
 * "this board" in its edit-access error means the successor's board, which is
 * often not the board the user is looking at — so never show the raw text.
 */
export function dependencyErrorMessage(
  error: { code?: string | null; message?: string | null } | null | undefined,
): string {
  const code = error?.code ?? "";
  const message = (error?.message ?? "").toLowerCase();
  if (code === "42501" || message.includes("no edit access"))
    return "You can't edit the board that item is on.";
  if (message.includes("cycle")) return "That would create a dependency loop.";
  if (message.includes("depend on itself"))
    return "An item can't depend on itself.";
  if (code === "P0002" || message.includes("not found"))
    return "That item is no longer available.";
  if (code === "23505") return "Those items are already linked.";
  return "Couldn't add the dependency.";
}
