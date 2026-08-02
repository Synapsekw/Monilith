import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { typedRpc } from "@/lib/supabase/typed-rpc";
import { getServerEnv } from "@/lib/env.server";
import {
  AiNotConfiguredError,
  AiDisabledError,
  ByoKeyMissingError,
} from "@/lib/ai/errors";
import { resolveUserAdapterById, asTrustedUserId } from "@/lib/ai/credentials";
import { requireAiEntitlement } from "@/lib/ai/entitlement";
import { getAdapter } from "@/lib/ai/providers/registry";
import type { AiProvider } from "@/lib/ai/providers/catalog";
import type { ProviderAdapter } from "@/lib/ai/providers/types";
import { readOrgAiSettings, type AiMode } from "@/lib/ai/org-settings";
import {
  computeCostUsd,
  costToCredits,
  type AiUsageTokens,
} from "@/lib/ai/pricing";

export type ResolvedAi = {
  adapter: ProviderAdapter;
  apiKey: string;
  mode: AiMode;
  provider: AiProvider;
};

/** The single chokepoint: picks the key + adapter for the org's ai_mode.
 *  `userId` is required because the `per_user` branch resolves THAT user's
 *  key — always pass the id of the person whose spend this call is (the same
 *  id you pass to runAi/record_ai_usage), never a session-derived id from a
 *  different source. */
export async function resolveAiAdapter(
  orgId: string,
  userId: string,
): Promise<ResolvedAi> {
  const svc = createServiceClient();
  const settings = await readOrgAiSettings(svc, orgId);

  switch (settings.mode) {
    case "off":
      throw new AiDisabledError();
    case "managed": {
      const apiKey = getServerEnv().ANTHROPIC_API_KEY;
      if (!apiKey) throw new AiNotConfiguredError();
      return {
        adapter: getAdapter("anthropic"),
        apiKey,
        mode: "managed",
        provider: "anthropic",
      };
    }
    case "org_byo": {
      const { data, error } = await svc.rpc("org_ai_secret_get", {
        p_org: orgId,
      });
      if (error) throw error;
      const row = data?.[0];
      if (!row?.secret) throw new ByoKeyMissingError();
      const provider = row.provider as AiProvider;
      return {
        adapter: getAdapter(provider),
        apiKey: row.secret,
        mode: "org_byo",
        provider,
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
      const { adapter, apiKey } = await resolveUserAdapterById(
        asTrustedUserId(userId),
      );
      return { adapter, apiKey, mode: "per_user", provider: adapter.id };
    }
  }
}

/**
 * Wraps one AI call: resolve → invoke → meter. All spend flows through here.
 * A ledger-write failure is logged, never surfaced — telemetry loss must not
 * break the user's request (revisit when managed billing hardens in E6).
 *
 * Usage is only metered when fn resolves — a provider call that consumes
 * tokens and then throws during post-processing is not billed (no usage is
 * available on the error path).
 */
export async function runAi<T>(
  args: { orgId: string; userId: string; feature: string },
  fn: (
    resolved: ResolvedAi,
  ) => Promise<{ result: T; usage: AiUsageTokens; model: string }>,
): Promise<T> {
  const resolved = await resolveAiAdapter(args.orgId, args.userId);
  const { result, usage, model } = await fn(resolved);
  const costUsd = computeCostUsd(model, usage);
  const credits = costToCredits(costUsd);
  const svc = createServiceClient();
  const { error } = await svc.rpc("record_ai_usage", {
    p_org: args.orgId,
    p_user: args.userId,
    p_feature: args.feature,
    p_provider: resolved.provider,
    p_model: model,
    p_input_tokens: usage.inputTokens,
    p_output_tokens: usage.outputTokens,
    p_cost_usd: costUsd,
    p_credits: credits,
  });
  if (error)
    console.error("[ai] record_ai_usage failed:", {
      org: args.orgId,
      feature: args.feature,
      model,
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
  const costUsd = computeCostUsd(model, usage);
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
