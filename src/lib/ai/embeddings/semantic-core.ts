import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { typedRpc } from "@/lib/supabase/typed-rpc";
import { runEmbedding } from "@/lib/ai/gateway";
import { createEmbeddingClient } from "./client";
import { toVectorLiteral } from "./index-actions";

export type SemanticHit = {
  id: string;
  name: string;
  boardId: string;
  boardName: string;
};

/** Bounded hot-path read: match_items itself clamps to 50. */
const MATCH_LIMIT = 20;

/**
 * Meaning-based search through an INJECTED client, so the cookie path and the
 * tool path (in-app assistant, external MCP) share one implementation. The
 * embed call is metered and entitlement-gated; a refusal is reported as
 * `ok: false` so the caller can fall back to name search and say so.
 */
export async function semanticSearchCore(
  supabase: SupabaseClient<Database>,
  args: {
    orgId: string;
    userId: string;
    query: string;
    boardIds?: string[];
    limit?: number;
  },
): Promise<{ ok: true; items: SemanticHit[] } | { ok: false }> {
  try {
    const client = createEmbeddingClient();
    const { vectors } = await runEmbedding(
      { orgId: args.orgId, userId: args.userId, feature: "semantic_query" },
      async () => {
        const r = await client.embed([args.query]);
        return {
          result: { vectors: r.vectors },
          usage: { inputTokens: r.inputTokens, outputTokens: 0 },
          model: r.model,
        };
      },
    );
    const embedding = vectors[0];
    if (!embedding) return { ok: false };

    const { data, error } = await typedRpc(supabase, "match_items", {
      p_query_embedding: toVectorLiteral(embedding),
      p_limit: args.limit ?? MATCH_LIMIT,
      p_org_id: args.orgId,
      ...(args.boardIds ? { p_board_ids: args.boardIds } : {}),
    });
    if (error) return { ok: false };
    return {
      ok: true,
      items: (data ?? []).map((r) => ({
        id: r.item_id,
        name: r.name,
        boardId: r.board_id,
        boardName: r.board_name,
      })),
    };
  } catch {
    return { ok: false };
  }
}
