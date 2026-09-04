import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { createServiceClient } from "@/lib/supabase/service";
import { boardFoldersTag } from "@/lib/cache/tags";
import type { BoardFolderData } from "@/lib/boards/folders/types";

// Defensive caps on a hot path that runs on ~every authenticated nav. Per-user
// folder and placement counts are naturally small; these bound a pathological
// account, matching MY_BOARDS_LIMIT in ../queries.ts.
const FOLDERS_LIMIT = 200;
const PLACEMENTS_LIMIT = 2000;

/**
 * Cached folders + placements for one user. `userId` is read OUTSIDE this scope
 * (in the shell server component) and passed in, so it is part of the cache key
 * and the cacheTag. Uses the cookie-free service client with an EXPLICIT
 * `user_id = userId` filter — that filter is the tenant boundary, because the
 * service client bypasses RLS.
 *
 * Returns `null` on error — the caller MUST be able to tell "we could not load
 * folders" from "this user has none". Both degrade the sidebar to today's flat
 * board list rather than blanking the shell, but only the second one licenses
 * `BoardsNav` to prune persisted `folder:*` collapse keys; a transient blip
 * reported as `{ folders: [] }` silently deleted every one of them. The
 * uncached sibling throws instead.
 */
export async function listBoardFoldersCached(
  userId: string,
): Promise<BoardFolderData | null> {
  "use cache";
  cacheLife("nav");
  cacheTag(boardFoldersTag(userId));

  const supabase = createServiceClient();
  const [foldersRes, placementsRes] = await Promise.all([
    supabase
      .from("board_folders")
      .select("id, name, position")
      .eq("user_id", userId)
      .limit(FOLDERS_LIMIT)
      .order("position", { ascending: true }),
    supabase
      .from("board_folder_boards")
      .select("board_id, folder_id, position")
      .eq("user_id", userId)
      .limit(PLACEMENTS_LIMIT)
      .order("position", { ascending: true }),
  ]);

  if (foldersRes.error || placementsRes.error) {
    return null;
  }

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
