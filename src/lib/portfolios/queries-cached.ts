import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { createServiceClient } from "@/lib/supabase/service";
import { boardsTag, folderMembersTag, sharedBoardsTag } from "@/lib/cache/tags";
import { READABLE_BOARDS_LIMIT } from "@/lib/portfolios/queries";
import { warnIfAtCap } from "@/lib/supabase/cap-warning";

const FOLDER_MEMBERSHIPS_LIMIT = 500;

export type ReadableBoard = { id: string; name: string; workspaceId: string };

/**
 * Cached `listReadableBoards`. `userId` is read OUTSIDE this scope and passed in
 * (cache key). The service client bypasses RLS, so this REPLICATES the boards
 * read policy (20260621000000_board_access_require_membership_and_returning.sql)
 * by hand: readable = ACTIVE org member AND (creator OR board_members grant OR
 * member of the board's folder, via folder_boards → folder_members, in the
 * board's own org). Any change to that policy must be mirrored here — the
 * cross-tenant isolation integration test is the tripwire.
 *
 * Tagged with the per-user tags, so every mutation that changes this set
 * invalidates it: board create/delete/rename → boardsTag (boards/actions.ts);
 * share/unshare → sharedBoardsTag (sharing-actions.ts); membership removal/
 * deactivation → both (org/admin-actions.ts); folder share/unshare/invite/
 * leave/move/delete → folderMembersTag (folders/sharing-actions.ts).
 */
export async function listReadableBoardsCached(
  userId: string,
): Promise<ReadableBoard[]> {
  "use cache";
  cacheLife("nav");
  cacheTag(
    boardsTag(userId),
    sharedBoardsTag(userId),
    folderMembersTag(userId),
  );

  const supabase = createServiceClient();

  // Active memberships only — mirrors is_org_member's deactivated_at filter.
  const { data: orgRows } = await supabase
    .from("org_members")
    .select("org_id")
    .eq("user_id", userId)
    .is("deactivated_at", null);
  const orgIds = (orgRows ?? []).map((r) => r.org_id);
  if (orgIds.length === 0) return [];

  const [own, shared, memberships] = await Promise.all([
    supabase
      .from("boards")
      .select("id, name, workspace_id")
      .eq("created_by", userId)
      .in("org_id", orgIds)
      // Every capped read has a total order: the cut past the cap must be the
      // same on every cache refresh.
      .order("id", { ascending: true })
      .limit(READABLE_BOARDS_LIMIT),
    supabase
      .from("board_members")
      .select("boards!inner(id, name, workspace_id, org_id)")
      .eq("user_id", userId)
      .order("board_id", { ascending: true })
      .limit(READABLE_BOARDS_LIMIT),
    supabase
      .from("folder_members")
      .select("folder_id, org_id")
      .eq("user_id", userId)
      .in("org_id", orgIds)
      .order("folder_id", { ascending: true })
      .limit(FOLDER_MEMBERSHIPS_LIMIT),
  ]);
  warnIfAtCap(
    "listReadableBoardsCached",
    "boards",
    own.data,
    READABLE_BOARDS_LIMIT,
  );
  warnIfAtCap(
    "listReadableBoardsCached",
    "board_members",
    shared.data,
    READABLE_BOARDS_LIMIT,
  );
  warnIfAtCap(
    "listReadableBoardsCached",
    "folder_members",
    memberships.data,
    FOLDER_MEMBERSHIPS_LIMIT,
  );

  // Folder grants in orgs where the membership is active (re-checked here as
  // well as in the query: the service client has no policy to lean on).
  const orgByFolder = new Map(
    (memberships.data ?? [])
      .filter((r) => orgIds.includes(r.org_id))
      .map((r) => [r.folder_id, r.org_id] as const),
  );
  const viaFolder =
    orgByFolder.size > 0
      ? await supabase
          .from("folder_boards")
          .select("folder_id, boards!inner(id, name, workspace_id, org_id)")
          .in("folder_id", [...orgByFolder.keys()])
          // folder_boards_folder_position_idx order, board_id (primary key)
          // as the tie-break.
          .order("folder_id", { ascending: true })
          .order("position", { ascending: true })
          .order("board_id", { ascending: true })
          .limit(READABLE_BOARDS_LIMIT)
      : { data: [] };
  warnIfAtCap(
    "listReadableBoardsCached",
    "folder_boards",
    viaFolder.data,
    READABLE_BOARDS_LIMIT,
  );

  const byId = new Map<string, ReadableBoard>();
  for (const b of own.data ?? []) {
    byId.set(b.id, { id: b.id, name: b.name, workspaceId: b.workspace_id });
  }
  for (const r of shared.data ?? []) {
    const b = r.boards;
    if (b && orgIds.includes(b.org_id)) {
      byId.set(b.id, { id: b.id, name: b.name, workspaceId: b.workspace_id });
    }
  }
  for (const r of viaFolder.data ?? []) {
    const b = r.boards;
    // The board must sit in the same org as the folder grant that reaches it.
    if (b && b.org_id === orgByFolder.get(r.folder_id)) {
      byId.set(b.id, { id: b.id, name: b.name, workspaceId: b.workspace_id });
    }
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}
