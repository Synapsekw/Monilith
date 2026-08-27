import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth/session";
import type { BoardFolderData } from "@/lib/boards/folders/types";

/**
 * Uncached folders + placements for the signed-in user, through the RLS client.
 * Mirrors `listMyBoards` vs `listMyBoardsCached`: this one throws, because a DB
 * failure is not "no folders". The nav uses the cached variant; this exists for
 * callers that need live data and for exercising the real policies.
 */
export async function listBoardFolders(): Promise<BoardFolderData> {
  const user = await getUser();
  if (!user) return { folders: [], placements: [] };

  const supabase = await createClient();
  const [foldersRes, placementsRes] = await Promise.all([
    supabase
      .from("board_folders")
      .select("id, name, position")
      .order("position", { ascending: true }),
    supabase
      .from("board_folder_boards")
      .select("board_id, folder_id, position")
      .order("position", { ascending: true }),
  ]);

  if (foldersRes.error)
    throw new Error(`Failed to load folders: ${foldersRes.error.message}`);
  if (placementsRes.error)
    throw new Error(
      `Failed to load folder placements: ${placementsRes.error.message}`,
    );

  return {
    folders: (foldersRes.data ?? []).map((f) => ({
      id: f.id,
      name: f.name,
      position: f.position,
    })),
    placements: (placementsRes.data ?? []).map((p) => ({
      boardId: p.board_id,
      folderId: p.folder_id,
      position: p.position,
    })),
  };
}
