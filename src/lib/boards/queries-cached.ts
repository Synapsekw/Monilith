import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { createServiceClient } from "@/lib/supabase/service";
import { boardsTag, sharedBoardsTag } from "@/lib/cache/tags";
import type { BoardListEntry, SharedBoardEntry } from "@/lib/boards/queries";

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
    .eq("created_by", userId);
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
 * Cached `listSharedBoards` — boards shared WITH `userId` by someone else.
 * Explicit `user_id = userId` filter is the tenant boundary; owner names are
 * resolved in a second scoped read.
 */
export async function listSharedBoardsCached(
  userId: string,
): Promise<SharedBoardEntry[]> {
  "use cache";
  cacheLife("nav");
  cacheTag(sharedBoardsTag(userId));

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("board_members")
    .select("access_level, boards!inner(id, name, position, created_by)")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error || !data) return [];
  const rows = data.filter((r) => r.boards && r.boards.created_by !== userId);

  const ownerIds = [...new Set(rows.map((r) => r.boards.created_by))];
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("id", ownerIds);
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));

  return rows.map((r) => ({
    id: r.boards.id,
    name: r.boards.name,
    position: r.boards.position,
    owner_name: nameById.get(r.boards.created_by) ?? null,
    access_level: r.access_level,
  }));
}
