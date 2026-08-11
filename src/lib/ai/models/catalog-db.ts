import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { ModelTier } from "@/lib/ai/models/feed-parse";

/** Access seam for `ai_models`. Row shapes live here and only here. */

export type ModelRow = {
  provider: string;
  /** The GATEWAY's id — the catalog key. NOT guaranteed callable anywhere. */
  modelId: string;
  /**
   * The provider-native id, confirmed against that provider's own model list.
   * Null until verified. Callers that make an inference request MUST send
   * `nativeModelId ?? modelId`.
   */
  nativeModelId: string | null;
  label: string;
  contextLength: number | null;
  maxOutputTokens: number | null;
  supportsTools: boolean;
  inputPricePerMtok: number | null;
  outputPricePerMtok: number | null;
  cacheReadPricePerMtok: number | null;
  cacheWritePricePerMtok: number | null;
  tier: ModelTier;
  status: "active" | "retired" | "needs_pricing";
};

const MODEL_COLS =
  "provider, model_id, native_model_id, label, context_length, max_output_tokens, supports_tools, input_price_per_mtok, output_price_per_mtok, cache_read_price_per_mtok, cache_write_price_per_mtok, tier, status";

type RawModelRow = {
  provider: string;
  model_id: string;
  native_model_id: string | null;
  label: string;
  context_length: number | null;
  max_output_tokens: number | null;
  supports_tools: boolean;
  input_price_per_mtok: number | string | null;
  output_price_per_mtok: number | string | null;
  cache_read_price_per_mtok: number | string | null;
  cache_write_price_per_mtok: number | string | null;
  tier: string;
  status: string;
};

/** Postgres `numeric` arrives as a string over PostgREST. */
function num(v: number | string | null): number | null {
  if (v === null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function toModelRow(raw: RawModelRow): ModelRow {
  return {
    provider: raw.provider,
    modelId: raw.model_id,
    nativeModelId: raw.native_model_id,
    label: raw.label,
    contextLength: raw.context_length,
    maxOutputTokens: raw.max_output_tokens,
    supportsTools: raw.supports_tools,
    inputPricePerMtok: num(raw.input_price_per_mtok),
    outputPricePerMtok: num(raw.output_price_per_mtok),
    cacheReadPricePerMtok: num(raw.cache_read_price_per_mtok),
    cacheWritePricePerMtok: num(raw.cache_write_price_per_mtok),
    tier: raw.tier as ModelTier,
    status: raw.status as ModelRow["status"],
  };
}

/**
 * Selectable models for one provider, cheapest input rate first.
 *
 * `status` + `id_verified` + `provider` is exactly `ai_models_selectable_idx`,
 * so this stays an index scan (working agreement #5).
 *
 * `verifiedOnly` defaults to TRUE, and that default is the gate that stops an
 * unverified id ever reaching a picker or a provider call: the catalog is
 * populated from the Gateway, whose model-id namespace is not the providers'
 * native namespace, so an unverified row may simply 404 at the provider. Pass
 * `false` only for diagnostics that want to see the quarantine.
 */
export async function listActiveModels(
  client: SupabaseClient<Database>,
  provider: string,
  opts: { verifiedOnly?: boolean } = {},
): Promise<ModelRow[]> {
  let query = client
    .from("ai_models")
    .select(MODEL_COLS)
    .eq("status", "active")
    .eq("provider", provider);
  if (opts.verifiedOnly !== false) query = query.eq("id_verified", true);
  const { data, error } = await query.order("input_price_per_mtok", {
    ascending: true,
    nullsFirst: false,
  });
  if (error) throw new Error(`listActiveModels: ${error.message}`);
  return (data ?? []).map((r) => toModelRow(r as RawModelRow));
}

/**
 * One model by its composite key, whatever its status AND whatever its
 * verification state (callers check). Deliberately NOT gated on
 * `id_verified`, so a caller can tell "retired" apart from "unverified" in
 * its messaging instead of both collapsing to "not found".
 */
export async function getModel(
  client: SupabaseClient<Database>,
  provider: string,
  modelId: string,
): Promise<ModelRow | null> {
  const { data, error } = await client
    .from("ai_models")
    .select(MODEL_COLS)
    .eq("provider", provider)
    .eq("model_id", modelId)
    .maybeSingle();
  if (error) throw new Error(`getModel: ${error.message}`);
  return data ? toModelRow(data as RawModelRow) : null;
}
