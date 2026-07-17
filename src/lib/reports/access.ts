import "server-only";
import { getBoardAccess } from "@/lib/boards/queries";

/** Returns the caller's access level for a board, or null if none. */
export async function reportBoardAccess(boardId: string) {
  return getBoardAccess(boardId);
}

/** True if the caller may edit reports for the board (owner/editor). */
export function canEditReports(
  access: "owner" | "editor" | "viewer" | null,
): boolean {
  return access === "owner" || access === "editor";
}
