import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { createServiceClient } from "@/lib/supabase/service";
import { foldersTag } from "@/lib/cache/tags";
import type { FolderNavData } from "./types";

const FOLDERS_LIMIT = 200;
const PLACEMENTS_LIMIT = 2000;

/**
 * Cached folders + placements for one workspace. `orgId`/`workspaceId` are read
 * OUTSIDE this scope (the shell loader) and passed in — they are the cache key
 * and, on the service client, the tenant boundary. `null` = the read failed
 * (callers must not confuse that with "no folders").
 */
export async function listFoldersCached(
  orgId: string,
  workspaceId: string,
): Promise<FolderNavData | null> {
  "use cache";
  cacheLife("nav");
  cacheTag(foldersTag(orgId));

  const supabase = createServiceClient();
  const [foldersRes, placementsRes] = await Promise.all([
    supabase
      .from("folders")
      .select("id, name, workspace_id, org_id, position")
      .eq("org_id", orgId)
      .eq("workspace_id", workspaceId)
      .limit(FOLDERS_LIMIT)
      .order("position", { ascending: true }),
    supabase
      .from("folder_boards")
      .select("board_id, folder_id, position, folders!inner(workspace_id)")
      .eq("folders.workspace_id", workspaceId)
      .limit(PLACEMENTS_LIMIT)
      .order("position", { ascending: true }),
  ]);
  if (foldersRes.error || placementsRes.error) return null;
  return {
    folders: (foldersRes.data ?? []).map((f) => ({
      id: f.id,
      name: f.name,
      workspaceId: f.workspace_id,
      orgId: f.org_id,
      position: f.position,
    })),
    placements: (placementsRes.data ?? []).map((p) => ({
      boardId: p.board_id,
      folderId: p.folder_id,
      position: p.position,
    })),
  };
}
