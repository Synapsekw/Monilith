"use server";

import { createClient } from "@/lib/supabase/server";
import type { RelationCandidate } from "@/components/boards/cells/RelationPicker";

/**
 * Target-board items the caller can read, bounded for the relation picker. RLS
 * scopes to readable boards; `search` is a case-insensitive contains filter on
 * the item name. Bounded by `limit` (default 50) — on larger boards only the
 * first matches show; search narrows it.
 */
export async function listRelationCandidates(
  targetBoardId: string,
  search = "",
  limit = 50,
): Promise<RelationCandidate[]> {
  const supabase = await createClient();
  let q = supabase
    .from("items")
    .select("id, name")
    .eq("board_id", targetBoardId)
    .order("position", { ascending: true })
    .limit(limit);
  if (search.trim()) q = q.ilike("name", `%${search.trim()}%`);
  const { data } = await q;
  return data ?? [];
}

/** Boards the caller can read (own + shared), for the relation-column target
 *  picker. RLS scopes to readable boards. */
export async function listRelationTargetBoards(): Promise<
  { id: string; name: string }[]
> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("boards")
    .select("id, name")
    .order("name", { ascending: true });
  return data ?? [];
}
