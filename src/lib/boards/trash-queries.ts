import "server-only";

import { getUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/types/database.types";

/**
 * Per-board Trash: the archived groups + archived top-level items for a board.
 * Both reads are bounded (`limit 200`) and served by the Trash partial indexes
 * (`archived_at is not null`), ordered newest-archived first, run in parallel.
 * RLS scopes the reads to boards the caller can read (an archived board stays
 * readable so its Trash can load).
 */
export async function getBoardTrash(boardId: string): Promise<{
  groups: Tables<"groups">[];
  items: Tables<"items">[];
}> {
  const supabase = await createClient();
  const [g, i] = await Promise.all([
    supabase
      .from("groups")
      .select("*")
      .eq("board_id", boardId)
      .not("archived_at", "is", null)
      .order("archived_at", { ascending: false })
      .limit(200),
    supabase
      .from("items")
      .select("*")
      .eq("board_id", boardId)
      .is("parent_id", null)
      .not("archived_at", "is", null)
      .order("archived_at", { ascending: false })
      .limit(200),
  ]);
  if (g.error) throw new Error(g.error.message);
  if (i.error) throw new Error(i.error.message);
  return { groups: g.data ?? [], items: i.data ?? [] };
}

/**
 * Workspace Trash: the archived boards the current user owns. Scoped to
 * `created_by = me` (board archive is owner-only, so Trash is the owner's list),
 * bounded (`limit 200`), served by the boards archived partial index.
 */
export async function getArchivedBoards(): Promise<
  Pick<Tables<"boards">, "id" | "name" | "workspace_id" | "archived_at">[]
> {
  const user = await getUser();
  if (!user) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("boards")
    .select("id, name, workspace_id, archived_at")
    .eq("created_by", user.id)
    .not("archived_at", "is", null)
    .order("archived_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return data ?? [];
}
