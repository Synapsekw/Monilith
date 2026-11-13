import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { AiProvider } from "@/lib/ai/providers/catalog";
import {
  DEFAULT_ASSISTANT_NAME,
  resolveAssistantName,
} from "@/lib/org/assistant-name";

export type AiMode = Database["public"]["Enums"]["ai_mode"];

export type OrgAiSettings = {
  mode: AiMode;
  tier: string;
  monthlyCreditLimit: number;
  byoProvider: AiProvider | null;
  byoKeyLast4: string | null;
  /**
   * The org's default provider + model, both null until an admin picks one.
   * They are the middle rung of `resolveModel`'s ladder: a pinned model wins,
   * then this, then the feature's tier. `defaultModelId` is a CATALOG KEY
   * (`ai_models.model_id`), meaningful only alongside `defaultProvider`.
   */
  defaultProvider: string | null;
  defaultModelId: string | null;
  maxAgentsPerUser: number;
  maxAgentRunsPerUserPerDay: number;
  /**
   * What THIS org calls the built-in platform assistant — the name every
   * render site shows instead of a hardcoded product string. Display only: the
   * bot's identity (`auth.users.email`) is global and unrenamed, because
   * `platform_agent_user_id()` resolves it by that email.
   */
  assistantName: string;
};

/**
 * What an org with no `org_ai_settings` row gets.
 *
 * `off` since Phase 10 E6: under managed-only billing an org that has not
 * subscribed has no AI. This was `per_user` until 2026-08-02, when
 * `20260802133040_org_ai_settings_backfill` wrote an explicit `per_user` row for
 * all 22 then-existing orgs — changing this constant alone would have silently
 * disabled AI for every one of them, because none had a row. Only genuinely new
 * orgs land here now, and they reach AI through a subscription (or, until
 * checkout ships, through `setOrgAiPlan` in the platform console).
 */
export const DEFAULT_ORG_AI_SETTINGS: OrgAiSettings = Object.freeze({
  mode: "off",
  tier: "none",
  monthlyCreditLimit: 0,
  byoProvider: null,
  byoKeyLast4: null,
  defaultProvider: null,
  defaultModelId: null,
  maxAgentsPerUser: 3,
  maxAgentRunsPerUserPerDay: 3,
  assistantName: DEFAULT_ASSISTANT_NAME,
});

/**
 * The org default model an UNPINNED call will REALLY run on — or null.
 *
 * `defaultProvider`/`defaultModelId` are only half a pin: `resolveAiAdapter`
 * (gateway.ts) honours `defaultModelId` ONLY when `defaultProvider` equals the
 * provider the mode itself resolves, and each mode resolves its own:
 *
 *   - `managed`  — always `anthropic` (the platform key is Anthropic's; any
 *                  other provider is refused outright).
 *   - `org_byo`  — `byoProvider`, the single key the org stores.
 *   - `per_user` — `defaultProvider` itself, falling back to `anthropic`.
 *   - `off`      — nothing runs at all.
 *
 * An admin may perfectly legally leave the org default pointing at, say, an
 * OpenAI model while the mode is `managed` (OrgAiSettingsForm allows it) — and
 * then the default is INERT: the run resolves an Anthropic tier default
 * instead. Anything that predicts the run's model from these two columns alone
 * — the reference-document budget meter, above all — must go through here, or
 * it will size a budget against a context window the run never gets.
 *
 * Returns null on mismatch rather than guessing, so the caller can fall back
 * to its own conservative assumption AND disclose that it is assuming.
 */
export function unpinnedDefaultModel(
  settings: OrgAiSettings,
): { provider: string; modelId: string } | null {
  if (!settings.defaultProvider || !settings.defaultModelId) return null;

  const resolved: string | null =
    settings.mode === "managed"
      ? "anthropic"
      : settings.mode === "org_byo"
        ? settings.byoProvider
        : settings.mode === "per_user"
          ? (settings.defaultProvider ?? "anthropic")
          : null; // "off" — no call resolves at all.

  if (resolved !== settings.defaultProvider) return null;
  return {
    provider: settings.defaultProvider,
    modelId: settings.defaultModelId,
  };
}

export async function readOrgAiSettings(
  client: SupabaseClient<Database>,
  orgId: string,
): Promise<OrgAiSettings> {
  const { data, error } = await client
    .from("org_ai_settings")
    .select(
      "ai_mode, tier, monthly_credit_limit, byo_provider, byo_key_last4, default_provider, default_model_id, max_agents_per_user, max_agent_runs_per_user_per_day, assistant_name",
    )
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return DEFAULT_ORG_AI_SETTINGS;
  return {
    mode: data.ai_mode,
    tier: data.tier,
    monthlyCreditLimit: data.monthly_credit_limit,
    byoProvider: (data.byo_provider as AiProvider | null) ?? null,
    byoKeyLast4: data.byo_key_last4,
    defaultProvider: data.default_provider,
    defaultModelId: data.default_model_id,
    maxAgentsPerUser: data.max_agents_per_user,
    maxAgentRunsPerUserPerDay: data.max_agent_runs_per_user_per_day,
    // Resolved, never raw. The column is NOT NULL with a default and a
    // 1..40 check, so a blank is unreachable through any supported path — but
    // a row read before the column existed, or through an older select list,
    // arrives as `undefined`, and an empty assistant name renders as a hole in
    // the sentence rather than as an error anyone would notice.
    assistantName: resolveAssistantName(data.assistant_name),
  };
}
