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
  /**
   * `ai_models.context_length`, straight from the catalog row — null only for
   * the handful of rows the daily feed refresh has not backfilled yet (see
   * `document-budget.ts`'s `NULL_CONTEXT_FALLBACK` for how a caller degrades
   * when it is). Threaded through so a caller that needs the model's actual
   * window (the reference-document budget) does not have to re-read the
   * catalog a second time for a row this function already fetched.
   */
  contextLength: number | null;
};

/**
 * A catalog price column is only usable if it is a finite, non-negative number.
 *
 * The live threat is NEGATIVE, not NaN. Two upstream layers already handle
 * non-finite values — `perMtok` (`models/feed-parse.ts`) nulls them at ingest,
 * and `toModelRow`'s `num()` (`models/catalog-db.ts`) maps any non-finite
 * PostgREST value to null — so through a real catalog read a NaN cannot reach
 * this function. A negative can: it survives `Number.isFinite`, and while
 * `perMtok` now quarantines it at ingest, `ai_models` has no CHECK constraint,
 * so a row written by any other path (a manual fix, a future importer) still
 * arrives here signed. A negative rate produces a negative cost — a silent
 * quota refund — and the `resolveModel` caller has no other guard.
 *
 * This is the last boundary before the numbers become money, so it validates
 * the full contract rather than only the reachable half, and treats an
 * unusable value as ABSENT: the model falls to its {@link applyRateFloor}
 * floor instead of billing garbage. The NaN cases are kept as unit contracts
 * so the guard cannot be narrowed on the assumption that upstream still holds.
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
  // BOTH ids: the floor table is written in the provider's spelling, which is
  // neither the catalog key nor (for Anthropic) the dated native id. Passing
  // only `row.modelId` silently lost the floor for every model whose Gateway id
  // uses a dot — see pricing.ts · floorKeyCandidates.
  return applyRateFloor(
    { modelId: row.modelId, nativeModelId: row.nativeModelId },
    catalog,
  );
}

function resolvedFrom(row: ModelRow, substituted: boolean) {
  return {
    model: row.modelId,
    requestModel: row.nativeModelId ?? row.modelId,
    rates: ratesOf(row),
    supportsTools: row.supportsTools,
    substituted,
    contextLength: row.contextLength,
  };
}

/**
 * PURE selection step, split out from the DB read so the whole decision matrix
 * is testable without a database. `active` is already filtered to status
 * 'active' for one provider and ordered cheapest input rate first.
 *
 * ## Precedence — four rungs, and the middle two are in this order ON PURPOSE
 *
 * ```
 * 1. requested            the agent's own pin
 * 2. orgDefaultModelId    Settings → AI → "Default model"
 * 3. tier                 the per-feature hint (model-map.ts)
 * 4. active[0]            the provider's cheapest active model
 * ```
 *
 * Rung 2 above rung 3 reads like a bug — the feature knows what it needs, the
 * admin does not — and it is not. The org default is a SPEND CONTROL, and it is
 * the only one an admin has: "run this org on Haiku" is exactly the setting a
 * tier-first ladder would silently reverse, routing every standard-tier feature
 * (eleven of the thirteen in `FEATURE_TIERS`) straight back onto the expensive
 * model the admin opted out of. The admin would learn about it from the invoice.
 *
 * It is also what the product promises in words: clearing the picker in
 * `OrgAiSettingsForm` is labelled *"No default — each feature picks its own
 * tier"*, i.e. the tier is what you get when there is NO default, and the
 * approved design (`docs/superpowers/specs/2026-08-10-provider-model-layer-design.md`
 * §3, rung 3) says the same — "org default, nudged by the feature's tier hint".
 * Flipping the ladder without also rewriting that copy would make the setting
 * mean something the UI denies.
 *
 * Two consequences worth naming, both tested:
 *
 *   - A default that is not in `active` (retired, or belonging to a provider
 *     this call is not serving) is simply an ABSENT rung — the tier decides,
 *     and `substituted` stays false. `substituted` reports a vanished PIN only;
 *     flagging a stale org default would banner every agent in the org at once.
 *   - This function is capability-BLIND. It never consults `supportsTools` or
 *     `contextLength`, so an org default that cannot call tools is honoured here
 *     and refused LOUDLY downstream — `ModelNotToolCapableError` in
 *     `app/api/ai/personal-agent/route.ts`, with `AgentEditor` warning at pick
 *     time. Loud beats silently substituting a model the admin did not choose.
 *     Turning rung 3 into a real capability constraint — a feature declares what
 *     it needs, the resolver takes the cheapest satisfying model and prefers the
 *     org default AMONG the satisfiers — is the open redesign. `ai_models` today
 *     carries `supports_tools`, `context_length` and `max_output_tokens` and
 *     nothing else, so anything beyond tools-and-window needs a migration.
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

  // Rungs 2-4. `active` is ordered cheapest-first, so `.find` over a tier
  // yields that tier's cheapest member and `active[0]` the cheapest overall.
  // The org default sits ABOVE the tier deliberately — see the precedence
  // block on this function before reordering these three lines.
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
      contextLength: null,
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
  /**
   * Overrides {@link tierForFeature} for a caller whose tier is decided by the
   * SIZE of the request rather than by the feature.
   *
   * It overrides the feature→tier MAP, not the ladder: this is still rung 3, so
   * an org default outranks whatever is passed here. A caller that escalates by
   * size still runs on the model the admin chose. See {@link pickModel}.
   *
   * CURRENTLY UNCONSUMED: `column_fill` was that caller, until its batch was
   * shown to be bounded by `COLUMN_FILL_MAX` well below any context limit and
   * the escalation was deleted. Kept as a tested seam rather than removed —
   * see the note beside `COLUMN_FILL_MAX` for when it comes back.
   */
  tier?: ModelTier;
}): Promise<ResolvedModel> {
  const active = await listActiveModels(args.client, args.provider);
  const picked = pickModel({
    active,
    requested: args.requested ?? null,
    orgDefaultModelId: args.orgDefaultModelId ?? null,
    tier: args.tier ?? tierForFeature(args.feature),
  });
  return { ...picked, provider: args.provider };
}

export { tierForFeature };
