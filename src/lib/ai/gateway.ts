import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { getServerEnv } from "@/lib/env.server";
import {
  AiNotConfiguredError,
  AiDisabledError,
  ByoKeyMissingError,
} from "@/lib/ai/errors";
import { resolveUserAdapter } from "@/lib/ai/credentials";
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

/** The single chokepoint: picks the key + adapter for the org's ai_mode. */
export async function resolveAiAdapter(orgId: string): Promise<ResolvedAi> {
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
    // per_user resolves the SESSION user's key (cookie-bound requireUser). Callers must
    // pass runAi a userId equal to the session user, or the ledger will attribute one
    // user's spend to another.
    case "per_user": {
      const { adapter, apiKey } = await resolveUserAdapter();
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
  const resolved = await resolveAiAdapter(args.orgId);
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
  const { error } = await svc.rpc("record_ai_usage", {
    p_org: args.orgId,
    // p_user is `string` in generated types but the column is nullable; a system
    // (cron) embedding legitimately has no user, so null is the honest value.
    p_user: args.userId as unknown as string,
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
