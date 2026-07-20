import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { runEmbedding } from "@/lib/ai/gateway";
import type { EmbeddingClient } from "./client";

/** The two metered embedding features (spec §5). */
export type EmbeddingFeature = "semantic_index" | "semantic_query";

/** A row ready to upsert into public.item_embeddings. */
export type ItemEmbeddingUpsert = {
  item_id: string;
  org_id: string;
  board_id: string;
  /** pgvector text literal, e.g. "[0.1,0.2,…]" — see toVectorLiteral. */
  embedding: string;
  content_hash: string;
  model: string;
};

/**
 * Serialize a numeric vector to pgvector's text input form. PostgREST passes RPC
 * args / row values as JSON, and pgvector accepts a text literal it casts to
 * `vector` — so both match_items(p_query_embedding) and item_embeddings inserts
 * take this string form.
 */
export function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(",")}]`;
}

/**
 * Meter one embedding call through the gateway (input-only) and return the raw
 * vectors + model. Wraps runEmbedding so entitlement gating + ai_usage metering
 * are never bypassed; the fixed platform key lives inside the EmbeddingClient.
 */
export async function embedTexts(
  args: { orgId: string; userId: string; feature: EmbeddingFeature },
  client: EmbeddingClient,
  texts: string[],
): Promise<{ vectors: number[][]; model: string }> {
  return runEmbedding(args, async () => {
    const { vectors, inputTokens, model } = await client.embed(texts);
    return {
      result: { vectors, model },
      usage: { inputTokens, outputTokens: 0 },
      model,
    };
  });
}

/**
 * Batch upsert embeddings (keyed by item_id). Writes with the service role — the
 * table is default-deny for clients (writes only through the service embed
 * endpoint). No-op on an empty batch.
 *
 * NOTE(types): `item_embeddings` is not yet in the generated Database types
 * (this migration is applied centrally, then `pnpm db:types` runs). Until then
 * the write goes through an untyped view of the service client; tighten to the
 * typed `.from("item_embeddings")` once the regenerated types land.
 */
export async function upsertItemEmbeddings(
  rows: ItemEmbeddingUpsert[],
  svc: SupabaseClient = createServiceClient() as unknown as SupabaseClient,
): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await svc
    .from("item_embeddings")
    .upsert(rows, { onConflict: "item_id" });
  if (error) throw error;
}
