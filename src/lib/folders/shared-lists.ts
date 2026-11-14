import type { SupabaseClient } from "@supabase/supabase-js";
import { updateTag } from "next/cache";
import type { Database } from "@/types/database.types";
import { sharedBoardsTag } from "@/lib/cache/tags";

/**
 * Who sees a board in their "Shared with me" list, and expiring those lists.
 * Shared by the folder actions (a placement change) and the board core (a
 * rename, archive, restore or delete), so a folder member's sidebar never keeps
 * a stale name or a board that is gone. Every read runs on the caller's RLS
 * client and is capped.
 */

type Db = SupabaseClient<Database>;

/** Read cap on the people a single change can reach. */
export const MEMBER_ROWS_LIMIT = 500;

/** Members of these folders. RLS client: only folders the caller can see answer. */
export async function folderMemberRows(
  supabase: Db,
  folderIds: string[],
): Promise<{ folder_id: string; user_id: string }[]> {
  if (folderIds.length === 0) return [];
  const { data } = await supabase
    .from("folder_members")
    .select("folder_id, user_id")
    .in("folder_id", folderIds)
    .limit(MEMBER_ROWS_LIMIT);
  return data ?? [];
}

/** These people's "Shared with me" lists are stale. */
export function invalidateSharedLists(rows: { user_id: string }[]): void {
  for (const id of new Set(rows.map((r) => r.user_id)))
    updateTag(sharedBoardsTag(id));
}

/**
 * Everyone who reaches this board as a share: its direct grantees and the
 * members of the folder it is filed in (a board sits in at most one folder).
 * Read BEFORE a delete — the cascade removes the rows that say who they were.
 */
export async function boardAudienceRows(
  supabase: Db,
  boardId: string,
): Promise<{ user_id: string }[]> {
  const [{ data: direct }, { data: placement }] = await Promise.all([
    supabase
      .from("board_members")
      .select("user_id")
      .eq("board_id", boardId)
      .limit(MEMBER_ROWS_LIMIT),
    supabase
      .from("folder_boards")
      .select("folder_id")
      .eq("board_id", boardId)
      .maybeSingle(),
  ]);
  const viaFolder = placement
    ? await folderMemberRows(supabase, [placement.folder_id])
    : [];
  return [...(direct ?? []), ...viaFolder];
}
