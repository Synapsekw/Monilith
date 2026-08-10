import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { ModelTier } from "@/lib/ai/models/feed-parse";

/** Access seam for `ai_models`. Row shapes live here and only here. */

export type ModelRow = {
  provider: string;
  modelId: string;
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
  "provider, model_id, label, context_length, max_output_tokens, supports_tools, input_price_per_mtok, output_price_per_mtok, cache_read_price_per_mtok, cache_write_price_per_mtok, tier, status";

type RawModelRow = {
  provider: string;
  model_id: string;
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
 * Active models for one provider, cheapest input rate first. `.eq("status",…)`
 * plus `.eq("provider",…)` is exactly `ai_models_status_provider_idx`, so this
 * stays an index scan (working agreement #5).
 */
export async function listActiveModels(
  client: SupabaseClient<Database>,
  provider: string,
): Promise<ModelRow[]> {
  const { data, error } = await client
    .from("ai_models")
    .select(MODEL_COLS)
    .eq("status", "active")
    .eq("provider", provider)
    .order("input_price_per_mtok", { ascending: true, nullsFirst: false });
  if (error) throw new Error(`listActiveModels: ${error.message}`);
  return (data ?? []).map((r) => toModelRow(r as RawModelRow));
}

/** One model by its composite key, whatever its status (callers check). */
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
