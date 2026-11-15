import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { createServiceClient } from "@/lib/supabase/service";
import { boardsTag, folderMembersTag, sharedBoardsTag } from "@/lib/cache/tags";
import { mergeSharedBoards } from "@/lib/boards/shared-merge";
import { warnIfAtCap } from "@/lib/supabase/cap-warning";
import type { BoardListEntry, SharedBoardEntry } from "@/lib/boards/queries";

// Bounds on the folder path (hot path: runs on ~every navigation).
const FOLDER_MEMBERSHIPS_LIMIT = 500;
const FOLDER_BOARDS_LIMIT = 500;
const DIRECT_BOARDS_LIMIT = 500;

/**
 * Cached `listMyBoards`. `userId` is read OUTSIDE this scope (in the shell server
 * component) and passed in, so it is part of the cache key and the cacheTag. Uses
 * the cookie-free service client with an EXPLICIT `created_by = userId` filter —
 * that filter is the tenant boundary (the service client bypasses RLS).
 */
export async function listMyBoardsCached(
  userId: string,
  workspaceId?: string,
): Promise<BoardListEntry[]> {
  "use cache";
  cacheLife("nav");
  cacheTag(boardsTag(userId));

  const supabase = createServiceClient();
  let query = supabase
    .from("boards")
    .select("id, name, workspace_id, position, board_members(user_id)")
    .eq("created_by", userId)
    .is("archived_at", null);
  if (workspaceId) query = query.eq("workspace_id", workspaceId);
  const { data, error } = await query.order("position", { ascending: true });
  if (error) return [];
  return (data ?? []).map((b) => ({
    id: b.id,
    name: b.name,
    workspace_id: b.workspace_id,
    position: b.position,
    shared_out: (b.board_members ?? []).length > 0,
  }));
}

/**
 * Cached `listSharedBoards` — boards shared WITH `userId` by someone else:
 * granted directly, or reached through a folder the user is a member of.
 *
 * The service client bypasses RLS, so this REPLICATES the boards read policy by
 * hand and must be exactly as strict: ACTIVE membership of the board's org AND
 * (creator OR board_members grant OR folder_members row on the board's folder).
 * Creator boards are the user's own list, so they are left out here. `userId`
 * comes from the server session (a cache key); the explicit `user_id` filters
 * are the tenant boundary. A board reached both ways is listed once, at the
 * higher level.
 *
 * Tags: `sharedBoardsTag` (board share/unshare, org removal) and
 * `folderMembersTag` (folder share/unshare/invite/leave/move/delete).
 */
export async function listSharedBoardsCached(
  userId: string,
): Promise<SharedBoardEntry[]> {
  "use cache";
  cacheLife("nav");
  cacheTag(sharedBoardsTag(userId), folderMembersTag(userId));

  const supabase = createServiceClient();
  const [directRes, orgRes, folderRes] = await Promise.all([
    supabase
      .from("board_members")
      .select(
        "access_level, boards!inner(id, name, position, created_by, org_id)",
      )
      .eq("user_id", userId)
      .is("boards.archived_at", null)
      .order("created_at", { ascending: true })
      // Total order (board_id breaks created_at ties) so the cut past the cap
      // is the same on every cache refresh; same cap as the uncached twin.
      .order("board_id", { ascending: true })
      .limit(DIRECT_BOARDS_LIMIT),
    // Active memberships only: a grant left behind after someone is removed
    // from the org must show nothing (the service client bypasses the
    // is_org_member check the SQL policy makes).
    supabase
      .from("org_members")
      .select("org_id")
      .eq("user_id", userId)
      .is("deactivated_at", null),
    supabase
      .from("folder_members")
      .select("folder_id, org_id, access_level")
      .eq("user_id", userId)
      // (user_id, folder_id) index order: a stable cut past the cap.
      .order("folder_id", { ascending: true })
      .limit(FOLDER_MEMBERSHIPS_LIMIT),
  ]);
  if (directRes.error || !directRes.data) return [];
  warnIfAtCap(
    "listSharedBoardsCached",
    "board_members",
    directRes.data,
    DIRECT_BOARDS_LIMIT,
  );
  warnIfAtCap(
    "listSharedBoardsCached",
    "folder_members",
    folderRes.data,
    FOLDER_MEMBERSHIPS_LIMIT,
  );

  const activeOrgs = new Set((orgRes.data ?? []).map((r) => r.org_id));
  const folderGrants = new Map(
    (folderRes.data ?? [])
      .filter((r) => activeOrgs.has(r.org_id))
      .map((r) => [r.folder_id, r] as const),
  );

  let folderRows: {
    folder_id: string;
    boards: {
      id: string;
      name: string;
      position: number;
      created_by: string;
      org_id: string;
    };
  }[] = [];
  if (folderGrants.size > 0) {
    const { data } = await supabase
      .from("folder_boards")
      .select("folder_id, boards!inner(id, name, position, created_by, org_id)")
      .in("folder_id", [...folderGrants.keys()])
      .is("boards.archived_at", null)
      // folder_boards_folder_position_idx order; board_id (the primary key)
      // breaks position ties so the cut past the cap is deterministic.
      .order("folder_id", { ascending: true })
      .order("position", { ascending: true })
      .order("board_id", { ascending: true })
      .limit(FOLDER_BOARDS_LIMIT);
    warnIfAtCap(
      "listSharedBoardsCached",
      "folder_boards",
      data,
      FOLDER_BOARDS_LIMIT,
    );
    folderRows = (data ?? []).filter(
      (r) =>
        r.boards &&
        r.boards.created_by !== userId &&
        r.boards.org_id === folderGrants.get(r.folder_id)?.org_id,
    );
  }

  const directRows = directRes.data.filter(
    (r) =>
      r.boards &&
      r.boards.created_by !== userId &&
      activeOrgs.has(r.boards.org_id),
  );

  const ownerIds = [
    ...new Set([
      ...directRows.map((r) => r.boards.created_by),
      ...folderRows.map((r) => r.boards.created_by),
    ]),
  ];
  const { data: profiles } =
    ownerIds.length > 0
      ? await supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", ownerIds)
      : { data: [] };
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));

  return mergeSharedBoards(
    directRows.map((r) => ({
      id: r.boards.id,
      name: r.boards.name,
      position: r.boards.position,
      owner_name: nameById.get(r.boards.created_by) ?? null,
      access_level: r.access_level,
      via: "direct" as const,
    })),
    folderRows.map((r) => ({
      id: r.boards.id,
      name: r.boards.name,
      position: r.boards.position,
      owner_name: nameById.get(r.boards.created_by) ?? null,
      // The filter above kept only rows whose folder has a grant.
      access_level: folderGrants.get(r.folder_id)!.access_level,
      via: "folder" as const,
    })),
  );
}
