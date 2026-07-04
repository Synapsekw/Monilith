"use server";

import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

const LIMIT = 25;

/** A single global-search hit: an item plus the board it lives on. */
export type ItemSearchResult = {
  id: string;
  name: string;
  boardId: string;
  boardName: string;
};

const searchItemsInputSchema = z.object({
  // Trimmed at the boundary; min 2 keeps the trigram index effective and stops
  // 1-char queries fanning out. Max 100 caps a pathological input.
  query: z.string().trim().min(2).max(100),
});

/**
 * Escape LIKE/ILIKE wildcards so user search text is matched literally. Postgres
 * treats `%`, `_`, and the escape char `\` specially in LIKE patterns; without
 * this a search of "50%" or "a_b" would match far more than intended. Escape `\`
 * first, then the wildcards. (Same helper posture as relation-candidates.)
 */
function escapeLikePattern(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Global item search for the command palette. Case-insensitive contains match on
 * `items.name`, backed by the `items_name_trgm_idx` GIN trigram index so the
 * leading-wildcard ILIKE stays indexed. RLS scopes the read to items on boards
 * the caller can read (org-scoped + can_read_board) — no service role. Bounded to
 * {@link LIMIT} rows ordered by recency (`updated_at` desc). The board name comes
 * from a single `boards!inner` embed (RLS-scoped, no N+1). Returns [] for a query
 * that fails validation (too short / too long) so callers never see a throw.
 */
export async function searchItems(query: string): Promise<ItemSearchResult[]> {
  const parsed = searchItemsInputSchema.safeParse({ query });
  if (!parsed.success) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("items")
    .select("id, name, board_id, boards!inner(name)")
    .ilike("name", `%${escapeLikePattern(parsed.data.query)}%`)
    .order("updated_at", { ascending: false })
    .limit(LIMIT);
  if (error) return [];

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    boardId: row.board_id,
    boardName: row.boards.name,
  }));
}
