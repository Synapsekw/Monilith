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
 * Global item search for the command palette. Delegates ranking to the
 * `search_items` RPC: a hybrid, index-assisted read (ILIKE-contains OR pg_trgm
 * word-similarity) ordered exact-contains -> similarity -> recency, backed by
 * the `items_name_trgm_idx` GIN index. The RPC is SECURITY INVOKER, so RLS
 * scopes results to items on boards the caller can read (org-scoped, no service
 * role). Bounded to {@link LIMIT} rows. Returns [] for a query that fails
 * validation or on any RPC error, so callers never see a throw.
 */
export async function searchItems(query: string): Promise<ItemSearchResult[]> {
  const parsed = searchItemsInputSchema.safeParse({ query });
  if (!parsed.success) return [];

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("search_items", {
    p_query: parsed.data.query,
    p_limit: LIMIT,
  });
  if (error) return [];

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    boardId: row.board_id,
    boardName: row.board_name,
  }));
}
