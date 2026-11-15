import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { typedRpc } from "@/lib/supabase/typed-rpc";

export type FolderLevel = "editor" | "viewer";

/** One person's access to a board through the board's folder. */
export type FolderGrant = {
  userId: string;
  access: FolderLevel;
  folderName: string;
};

/** The higher of a direct board grant and a folder grant. Editor beats viewer. */
export function higherAccess(
  direct: FolderLevel | null,
  folder: FolderLevel | null,
): FolderLevel | null {
  if (direct === "editor" || folder === "editor") return "editor";
  return direct ?? folder ?? null;
}

/**
 * The CALLER's folder-derived level on each of these boards, for boards that
 * sit in a folder the caller is a member of. The RPC resolves the caller from
 * `auth.uid()`, so the client must be the caller's own (cookie or bridged MCP)
 * client, never the service client.
 *
 * Fails closed: an error, or a test double without `rpc`, yields no folder
 * access rather than an exception on a page that would otherwise render.
 */
export async function listMyFolderBoardLevels(
  supabase: SupabaseClient<Database>,
  boardIds: string[],
): Promise<Map<string, FolderLevel>> {
  const levels = new Map<string, FolderLevel>();
  if (boardIds.length === 0) return levels;
  try {
    const { data, error } = await typedRpc(supabase, "my_folder_board_levels", {
      p_board_ids: boardIds,
    });
    if (error || !data) return levels;
    for (const row of data) levels.set(row.board_id, row.access_level);
  } catch {
    return levels;
  }
  return levels;
}
