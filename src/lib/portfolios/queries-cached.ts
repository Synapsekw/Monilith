import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { createServiceClient } from "@/lib/supabase/service";
import { boardsTag, sharedBoardsTag } from "@/lib/cache/tags";
import { READABLE_BOARDS_LIMIT } from "@/lib/portfolios/queries";

export type ReadableBoard = { id: string; name: string; workspaceId: string };

/**
 * Cached `listReadableBoards`. `userId` is read OUTSIDE this scope and passed in
 * (cache key). The service client bypasses RLS, so this REPLICATES the boards
 * read policy (20260621000000_board_access_require_membership_and_returning.sql)
 * by hand: readable = ACTIVE org member AND (creator OR board_members grant).
 * Any change to that policy must be mirrored here — the cross-tenant isolation
 * integration test is the tripwire.
 *
 * Tagged with the two EXISTING per-user tags, so every mutation that changes
 * this set already invalidates it with zero writer changes: board create/
 * delete/rename → boardsTag (boards/actions.ts); share/unshare →
 * sharedBoardsTag (sharing-actions.ts); membership removal/deactivation →
 * both (org/admin-actions.ts).
 */
export async function listReadableBoardsCached(
  userId: string,
): Promise<ReadableBoard[]> {
  "use cache";
  cacheLife("nav");
  cacheTag(boardsTag(userId), sharedBoardsTag(userId));

  const supabase = createServiceClient();

  // Active memberships only — mirrors is_org_member's deactivated_at filter.
  const { data: orgRows } = await supabase
    .from("org_members")
    .select("org_id")
    .eq("user_id", userId)
    .is("deactivated_at", null);
  const orgIds = (orgRows ?? []).map((r) => r.org_id);
  if (orgIds.length === 0) return [];

  const [own, shared] = await Promise.all([
    supabase
      .from("boards")
      .select("id, name, workspace_id")
      .eq("created_by", userId)
      .in("org_id", orgIds)
      .limit(READABLE_BOARDS_LIMIT),
    supabase
      .from("board_members")
      .select("boards!inner(id, name, workspace_id, org_id)")
      .eq("user_id", userId)
      .limit(READABLE_BOARDS_LIMIT),
  ]);

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
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}
