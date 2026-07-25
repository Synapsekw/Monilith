"use server";

import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { resolveActiveOrg } from "@/lib/org/active";
import { createClient } from "@/lib/supabase/server";
import { typedRpc } from "@/lib/supabase/typed-rpc";
import { runEmbedding } from "@/lib/ai/gateway";
import { createEmbeddingClient } from "./client";
import { toVectorLiteral } from "./index-actions";

/** A semantic hit: an item plus the board it lives on (mirrors ItemSearchResult
 *  so the two surfaces render through one row shape). */
export type SemanticSearchResult = {
  id: string;
  name: string;
  boardId: string;
  boardName: string;
};

/** Find-similar has a third state beyond hits/empty: the item may not be
 *  embedded yet (the async sweep hasn't reached it), which the UI surfaces as a
 *  distinct "indexing…" affordance rather than a misleading "no matches". */
export type FindSimilarResult =
  | { status: "ok"; items: SemanticSearchResult[] }
  | { status: "not_indexed" };

/** Bounded hot-path read: match_items itself clamps ≤ 50 (spec §6); 20 keeps the
 *  Ask-tool payload and the panel list tight. */
const MATCH_LIMIT = 20;

const querySchema = z.object({
  // Same boundary as lexical search (item-search.ts): min 2 keeps the query
  // meaningful, max 100 caps a pathological input that would flow into the
  // metered embed call verbatim.
  query: z.string().trim().min(2).max(100),
});

const itemIdSchema = z.string().uuid();

type MatchRow = {
  item_id: string;
  name: string;
  board_id: string;
  board_name: string;
};

function mapRows(rows: MatchRow[] | null): SemanticSearchResult[] {
  return (rows ?? []).map((r) => ({
    id: r.item_id,
    name: r.name,
    boardId: r.board_id,
    boardName: r.board_name,
  }));
}

/**
 * Meaning-based item search. Embeds the query through the metered gateway path
 * (feature `semantic_query`, entitlement-gated — 1 input-only call), then ranks
 * via the `match_items` RPC. The RPC is SECURITY INVOKER, so RLS scopes results
 * to items on boards the caller can read (no cross-tenant leak, same posture as
 * lexical `search_items`). Bounded to {@link MATCH_LIMIT}. Returns [] for a
 * query that fails validation or on ANY error — callers never see a throw.
 */
export async function semanticSearchItems(
  query: string,
): Promise<SemanticSearchResult[]> {
  const parsed = querySchema.safeParse({ query });
  if (!parsed.success) return [];
  try {
    const user = await requireUser();
    const org = await resolveActiveOrg();
    if (!org) return [];

    const client = createEmbeddingClient();
    const { vectors } = await runEmbedding(
      { orgId: org.id, userId: user.id, feature: "semantic_query" },
      async () => {
        const r = await client.embed([parsed.data.query]);
        return {
          result: { vectors: r.vectors },
          usage: { inputTokens: r.inputTokens, outputTokens: 0 },
          model: r.model,
        };
      },
    );
    const embedding = vectors[0];
    if (!embedding) return [];

    const supabase = await createClient();
    const { data, error } = await typedRpc(supabase, "match_items", {
      p_query_embedding: toVectorLiteral(embedding),
      p_limit: MATCH_LIMIT,
    });
    if (error) return [];
    return mapRows(data as MatchRow[] | null);
  } catch {
    return [];
  }
}

/**
 * "Find similar" from an item panel. Reuses the item's STORED embedding (no new
 * embed call — 0 model round-trips, per the perf budget) and ranks its
 * neighbours via `match_items` with `p_exclude_item_id` so the item never
 * matches itself. RLS-scoped: the caller can only read its own item's embedding
 * and only sees neighbours on readable boards. Returns `{status:"not_indexed"}`
 * when the item has no embedding yet (queued but not swept) so the UI can show a
 * graceful "indexing…" state; never throws.
 */
export async function findSimilarItems(
  itemId: string,
): Promise<FindSimilarResult> {
  const parsed = itemIdSchema.safeParse(itemId);
  if (!parsed.success) return { status: "ok", items: [] };
  try {
    const supabase = await createClient();
    const { data: stored, error: storedErr } = await supabase
      .from("item_embeddings")
      .select("embedding")
      .eq("item_id", parsed.data)
      .maybeSingle();
    if (storedErr) return { status: "ok", items: [] };
    if (!stored?.embedding) return { status: "not_indexed" };

    const { data, error } = await typedRpc(supabase, "match_items", {
      // pgvector returns the stored vector as its text literal, exactly the form
      // match_items accepts back for p_query_embedding — no re-serialization.
      p_query_embedding: stored.embedding,
      p_limit: MATCH_LIMIT,
      p_exclude_item_id: parsed.data,
    });
    if (error) return { status: "ok", items: [] };
    return { status: "ok", items: mapRows(data as MatchRow[] | null) };
  } catch {
    return { status: "ok", items: [] };
  }
}
