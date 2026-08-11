import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { ModelTier } from "@/lib/ai/models/feed-parse";
import { applyRateFloor, type ModelRates } from "@/lib/ai/pricing";
import { listActiveModels, type ModelRow } from "@/lib/ai/models/catalog-db";
import { tierForFeature } from "@/lib/ai/model-map";

export type ResolvedModel = {
  /**
   * The CATALOG KEY (the Gateway's `model_id`). This is what a pin references,
   * what a picker shows, and what the usage ledger records. Null only when the
   * provider has no active catalog models at all — callers must handle it
   * (the agent path throws `ByoKeyMissingError`).
   */
  model: string | null;
  /**
   * What to put on the wire: `nativeModelId ?? modelId`. The Gateway's id
   * namespace is NOT each provider's native namespace — the feed publishes
   * `claude-haiku-4.5` where Anthropic's own API wants the dated snapshot
   * `claude-haiku-4-5-20251001` — so sending {@link model} to a provider with
   * a BYO key is a 404. Never send `model`; always send this.
   */
  requestModel: string | null;
  provider: string;
  rates: ModelRates | null;
  supportsTools: boolean;
  /** True when a pinned model was unavailable and the default was used. */
  substituted: boolean;
};

/**
 * A catalog price column is only usable if it is a finite, non-negative
 * number. `numeric` arrives over PostgREST as a string and is coerced upstream
 * in `toModelRow`, so a malformed column reaches here as NaN — and NaN (or a
 * negative) flows straight through `computeCostUsd` into a NaN cost, which
 * serializes to `null` at the `record_ai_usage` boundary. That is spend that
 * silently vanishes rather than failing, so the column is validated at this
 * boundary and an unusable value is treated as ABSENT: the model falls to its
 * {@link applyRateFloor} floor instead of billing garbage.
 */
const priceSchema = z.number().finite().nonnegative();

function usablePrice(value: number | null, context: string): number | null {
  if (value === null) return null;
  const parsed = priceSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  console.error("[ai] unusable catalog price, falling back to the floor:", {
    column: context,
    value,
  });
  return null;
}

/**
 * Rates for one catalog row, validated and bound to the fallback floor.
 *
 * Returns null — which `computeCostUsd` bills as $0 — only for a model that is
 * in neither the catalog nor `FALLBACK_RATES`.
 */
function ratesOf(row: ModelRow): ModelRates | null {
  const key = `${row.provider}/${row.modelId}`;
  const input = usablePrice(row.inputPricePerMtok, `${key}.input`);
  const output = usablePrice(row.outputPricePerMtok, `${key}.output`);
  // Both halves of the per-token arithmetic are required for the row to price
  // itself at all; either one missing means the floor decides.
  const catalog: ModelRates | null =
    input === null || output === null
      ? null
      : {
          input,
          output,
          cacheRead: usablePrice(row.cacheReadPricePerMtok, `${key}.cacheRead`),
          cacheWrite: usablePrice(
            row.cacheWritePricePerMtok,
            `${key}.cacheWrite`,
          ),
        };
  return applyRateFloor(row.modelId, catalog);
}

function resolvedFrom(row: ModelRow, substituted: boolean) {
  return {
    model: row.modelId,
    requestModel: row.nativeModelId ?? row.modelId,
    rates: ratesOf(row),
    supportsTools: row.supportsTools,
    substituted,
  };
}

/**
 * PURE selection step, split out from the DB read so the whole decision matrix
 * is testable without a database. `active` is already filtered to status
 * 'active' for one provider and ordered cheapest input rate first.
 */
export function pickModel(args: {
  active: ModelRow[];
  requested: string | null;
  orgDefaultModelId: string | null;
  tier: ModelTier;
}): Omit<ResolvedModel, "provider"> {
  const { active, requested, orgDefaultModelId, tier } = args;
  const byId = (id: string | null) =>
    id ? (active.find((m) => m.modelId === id) ?? null) : null;

  const pinned = byId(requested);
  if (pinned) return resolvedFrom(pinned, false);

  // A pinned-but-missing model is a SUBSTITUTION (the agent gets flagged); a
  // model that was never pinned is just the ordinary default path.
  const substituted = requested !== null && requested !== "";

  // `active` is ordered cheapest-first, so `.find` over a tier yields that
  // tier's cheapest member and `active[0]` the cheapest overall.
  const chosen =
    byId(orgDefaultModelId) ??
    active.find((m) => m.tier === tier) ??
    active[0] ??
    null;

  if (!chosen)
    return {
      model: null,
      requestModel: null,
      rates: null,
      supportsTools: false,
      substituted,
    };

  return resolvedFrom(chosen, substituted);
}

/** Read the provider's active catalog, then apply {@link pickModel}. */
export async function resolveModel(args: {
  client: SupabaseClient<Database>;
  provider: string;
  feature: string;
  requested?: string | null;
  orgDefaultModelId?: string | null;
}): Promise<ResolvedModel> {
  const active = await listActiveModels(args.client, args.provider);
  const picked = pickModel({
    active,
    requested: args.requested ?? null,
    orgDefaultModelId: args.orgDefaultModelId ?? null,
    tier: tierForFeature(args.feature),
  });
  return { ...picked, provider: args.provider };
}

export { tierForFeature };
