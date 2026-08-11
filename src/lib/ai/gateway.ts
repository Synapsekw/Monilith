import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { typedRpc } from "@/lib/supabase/typed-rpc";
import { getServerEnv } from "@/lib/env.server";
import {
  AiNotConfiguredError,
  AiDisabledError,
  ByoKeyMissingError,
  NoUsableModelError,
} from "@/lib/ai/errors";
import { resolveUserAdapterById, asTrustedUserId } from "@/lib/ai/credentials";
import { requireAiEntitlement } from "@/lib/ai/entitlement";
import { getAdapter } from "@/lib/ai/providers/registry";
import { getProviderRow } from "@/lib/ai/providers/provider-rows";
import type { ProviderAdapter } from "@/lib/ai/providers/types";
import { readOrgAiSettings, type AiMode } from "@/lib/ai/org-settings";
import { resolveModel, type ResolvedModel } from "@/lib/ai/models/resolve";
import type { ModelTier } from "@/lib/ai/models/feed-parse";
import {
  computeCostUsd,
  costToCredits,
  ratesForModel,
  type AiUsageTokens,
} from "@/lib/ai/pricing";

export type ResolvedAi = {
  adapter: ProviderAdapter;
  apiKey: string;
  /** Non-null exactly for openai-compatible providers. */
  baseUrl: string | null;
  mode: AiMode;
  provider: string;
  /**
   * `org_ai_settings.default_model_id`, but ONLY when the org's
   * `default_provider` is the provider resolved above — a catalog key is
   * meaningless to a different provider. Carried here so `runAi` gets the
   * middle rung of `resolveModel`'s ladder without a second read of the same
   * settings row.
   */
  orgDefaultModelId: string | null;
};

/** A {@link ResolvedModel} that actually has a model — see `runAi`'s null gate. */
export type UsableModel = Omit<ResolvedModel, "model" | "requestModel"> & {
  model: string;
  requestModel: string;
};

/** What `runAi` hands its callback: the key, the adapter, and the model to run. */
export type ResolvedAiCall = ResolvedAi & { model: UsableModel };

/**
 * The single chokepoint: picks the key + adapter for the org's ai_mode.
 *
 * `provider` names WHICH provider's key to resolve — supplied when an agent has
 * pinned a model, omitted to take the mode's own provider. `userId` is required
 * because the `per_user` branch resolves THAT user's key — always pass the id of
 * the person whose spend this call is (the same id you pass to
 * runAi/record_ai_usage), never a session-derived id from a different source.
 *
 * This is also the only place a DISABLED provider is refused. `listActiveModels`
 * filters status/provider/id_verified but does not join `ai_providers.enabled`,
 * and `runAi` is the only production caller of `resolveModel` — so every catalog
 * read on the inference path passes through this gate first.
 */
export async function resolveAiAdapter(
  orgId: string,
  userId: string,
  provider?: string,
): Promise<ResolvedAi> {
  const svc = createServiceClient();
  const settings = await readOrgAiSettings(svc, orgId);
  const defaultModelIdFor = (resolvedProvider: string) =>
    settings.defaultProvider === resolvedProvider
      ? settings.defaultModelId
      : null;

  switch (settings.mode) {
    case "off":
      throw new AiDisabledError();

    case "managed": {
      // The platform key is Anthropic's; a request for any other provider
      // cannot be served under managed mode.
      const wanted = provider ?? "anthropic";
      if (wanted !== "anthropic") throw new ByoKeyMissingError(wanted);
      const apiKey = getServerEnv().ANTHROPIC_API_KEY;
      if (!apiKey) throw new AiNotConfiguredError();
      const row = await getProviderRow(svc, "anthropic");
      if (!row || !row.enabled) throw new AiNotConfiguredError();
      return {
        adapter: getAdapter(row.adapterKind),
        apiKey,
        baseUrl: row.baseUrl,
        mode: "managed",
        provider: "anthropic",
        orgDefaultModelId: defaultModelIdFor("anthropic"),
      };
    }

    case "org_byo": {
      // The org stores ONE key, so `byo_provider` is the only provider it can
      // serve; a request for another one is a missing key, not a fallback.
      const wanted = provider ?? settings.byoProvider;
      if (!wanted) throw new ByoKeyMissingError();
      const { data, error } = await svc.rpc("org_ai_secret_get", {
        p_org: orgId,
        p_provider: wanted,
      });
      if (error) throw error;
      const secret = data?.[0];
      if (!secret?.secret) throw new ByoKeyMissingError(wanted);
      const row = await getProviderRow(svc, wanted);
      if (!row || !row.enabled) throw new ByoKeyMissingError(wanted);
      return {
        adapter: getAdapter(row.adapterKind),
        apiKey: secret.secret,
        baseUrl: row.baseUrl,
        mode: "org_byo",
        provider: wanted,
        orgDefaultModelId: defaultModelIdFor(wanted),
      };
    }

    // per_user resolves the SUPPLIED userId's key (session-less, service-role
    // read) — not a cookie-bound session. This is what makes the gateway
    // usable from cron/service-role callers (e.g. the personal-agent sweep)
    // that have no session at all: they already know, from their own scoped
    // data, which user's spend this is, and pass that same id to runAi for
    // the ledger. Credential resolution and ledger attribution therefore
    // always agree by construction — never resolve a different id here than
    // the one passed to runAi's `userId`.
    //
    // TRUST: `asTrustedUserId(userId)` is safe HERE because every caller of
    // this function is itself either (a) a Server Action/route that derived
    // `userId` from its own `requireUser()` session before ever calling
    // runAi/resolveAiAdapter, or (b) a service-role cron handler (e.g.
    // personal-agent's route.ts) that derived it from an HMAC-verified
    // request's own DB row (`agent.owner_id`), never from a request
    // parameter passed straight through. This is the ONE call site allowed
    // to mint a TrustedUserId — see credentials.ts for what that buys.
    case "per_user": {
      // The org's default provider is the fallback, not a hard route: a user
      // with no key for it gets a PersonalAiKeyMissingError naming it, which
      // is the actionable message. `anthropic` remains the floor for the orgs
      // that have never picked a default.
      const wanted = provider ?? settings.defaultProvider ?? "anthropic";
      const { adapter, apiKey, baseUrl } = await resolveUserAdapterById(
        asTrustedUserId(userId),
        wanted,
      );
      return {
        adapter,
        apiKey,
        baseUrl,
        mode: "per_user",
        provider: wanted,
        orgDefaultModelId: defaultModelIdFor(wanted),
      };
    }
  }
}

/**
 * Wraps one AI call: resolve key → resolve model → invoke → meter. All spend
 * flows through here. A ledger-write failure is logged, never surfaced —
 * telemetry loss must not break the user's request (revisit when managed
 * billing hardens in E6).
 *
 * The callback returns only `{ result, usage }`: the model and its rates both
 * come from the ONE catalog row resolved here, so they cannot disagree. A
 * callback that reported its own model could name a row whose price was never
 * read — and `computeCostUsd(null, …)` bills that at $0.
 *
 * Usage is only metered when fn resolves — a provider call that consumes
 * tokens and then throws during post-processing is not billed (no usage is
 * available on the error path).
 */
export async function runAi<T>(
  args: {
    orgId: string;
    userId: string;
    feature: string;
    /** Resolve THIS provider's key (an agent pin), not the mode's default. */
    provider?: string;
    /** A pinned CATALOG key. Unavailable pins fall back and set `substituted`. */
    requestedModel?: string | null;
    /** Overrides {@link tierForFeature} for a size-dependent call (column_fill). */
    tier?: ModelTier;
  },
  fn: (
    resolved: ResolvedAiCall,
  ) => Promise<{ result: T; usage: AiUsageTokens }>,
): Promise<T> {
  const resolved = await resolveAiAdapter(
    args.orgId,
    args.userId,
    args.provider,
  );
  const svc = createServiceClient();
  const model = await resolveModel({
    client: svc,
    provider: resolved.provider,
    feature: args.feature,
    requested: args.requestedModel,
    orgDefaultModelId: resolved.orgDefaultModelId,
    tier: args.tier,
  });
  // No active, id-verified row for this provider. Throwing is the point: an
  // unpriced model bills nothing, so "run it anyway" would buy free inference.
  if (model.model === null || model.requestModel === null)
    throw new NoUsableModelError(resolved.provider);
  const usable = model as UsableModel;

  const { result, usage } = await fn({ ...resolved, model: usable });
  // resolved.rates, never a re-derivation: the fallback floor and the price
  // validation in resolveModel apply to THIS row, and re-reading rates by model
  // id here would silently drop both (see pricing.ts · applyRateFloor).
  const costUsd = computeCostUsd(usable.rates, usage);
  const credits = costToCredits(costUsd);
  const { error } = await svc.rpc("record_ai_usage", {
    p_org: args.orgId,
    p_user: args.userId,
    p_feature: args.feature,
    p_provider: resolved.provider,
    // The CATALOG key, not the wire id: pins, pickers and the ledger all speak
    // `ai_models.model_id`.
    p_model: usable.model,
    p_input_tokens: usage.inputTokens,
    p_output_tokens: usage.outputTokens,
    p_cache_read_tokens: usage.cacheReadTokens ?? 0,
    p_cache_write_tokens: usage.cacheWriteTokens ?? 0,
    p_cost_usd: costUsd,
    p_credits: credits,
  });
  if (error)
    console.error("[ai] record_ai_usage failed:", {
      org: args.orgId,
      feature: args.feature,
      model: usable.model,
      credits,
      cause: error.message,
    });
  return result;
}

/**
 * Embedding sibling of runAi (E5 · F15). Semantic search needs one FIXED model
 * for the whole corpus, so embeddings use a platform key (NOT the org's adapter)
 * — resolveAiAdapter is bypassed. The org's ai_mode still gates via
 * requireAiEntitlement (`off` ⇒ no indexing; `managed` at-quota ⇒ blocked, so
 * embedding + query spend counts against the monthly ceiling), and the
 * input-only call is metered into ai_usage exactly like a chat call, with
 * output_tokens = 0 (computeCostUsd handles the zero-rate arithmetic). Provider
 * is fixed to "openai" (the platform embedding provider).
 *
 * The model is fixed and always present in FALLBACK_RATES, so this path prices
 * from the floor rather than the catalog — deliberately, since the corpus must
 * not follow whatever the catalog offers today.
 *
 * A ledger-write failure is logged, never surfaced — telemetry loss must not
 * break the pipeline (parity with runAi).
 */
export async function runEmbedding<T>(
  // userId is nullable: the F15 sweep/backfill runs from cron with no user
  // session, so system-attributed embedding usage logs user_id = null
  // (ai_usage.user_id is nullable). The interactive query path passes a real id.
  args: { orgId: string; userId: string | null; feature: string },
  fn: () => Promise<{ result: T; usage: AiUsageTokens; model: string }>,
): Promise<T> {
  await requireAiEntitlement(args.orgId, args.feature);
  const { result, usage, model } = await fn();
  const costUsd = computeCostUsd(ratesForModel(model), usage);
  const credits = costToCredits(costUsd);
  const svc = createServiceClient();
  // typedRpc, not svc.rpc: p_user is `string` in the generated types but the
  // SQL parameter is nullable, and a system (cron) embedding legitimately has
  // no user. typedRpc widens every arg to `| null`, which is what the function
  // signature actually accepts — so null passes without a cast.
  const { error } = await typedRpc(svc, "record_ai_usage", {
    p_org: args.orgId,
    p_user: args.userId,
    p_feature: args.feature,
    p_provider: "openai",
    p_model: model,
    p_input_tokens: usage.inputTokens,
    p_output_tokens: usage.outputTokens,
    p_cache_read_tokens: usage.cacheReadTokens ?? 0,
    p_cache_write_tokens: usage.cacheWriteTokens ?? 0,
    p_cost_usd: costUsd,
    p_credits: credits,
  });
  if (error)
    console.error("[ai] record_ai_usage failed (embedding):", {
      org: args.orgId,
      feature: args.feature,
      model,
      credits,
      cause: error.message,
    });
  return result;
}
