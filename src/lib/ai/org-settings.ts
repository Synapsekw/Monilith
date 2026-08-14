import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { AiProvider } from "@/lib/ai/providers/catalog";
import {
  AGENT_CAPABILITIES,
  type AgentCapability,
} from "@/lib/agents/capabilities";

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
   * The org-wide CEILING on what a personal agent may be granted — the admin
   * half of a two-key gate. An agent's effective permission is its own
   * `user_agents.capabilities` INTERSECT this list INTERSECT the owner's RLS,
   * so lowering the ceiling clamps every agent in the org at once without
   * editing any of them. Mirrors `org_ai_settings.agent_capability_ceiling`.
   */
  agentCapabilityCeiling: AgentCapability[];
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
export const DEFAULT_ORG_AI_SETTINGS: OrgAiSettings = {
  mode: "off",
  tier: "none",
  monthlyCreditLimit: 0,
  byoProvider: null,
  byoKeyLast4: null,
  defaultProvider: null,
  defaultModelId: null,
  maxAgentsPerUser: 3,
  maxAgentRunsPerUserPerDay: 3,
  // Deliberately the FULL vocabulary, matching the column default: the inner
  // gate (`user_agents.capabilities`, default '{}') is already closed, so a
  // closed ceiling too would ship the feature invisible and demand an admin
  // round-trip before anyone's first agent could act. A row-less org is
  // `mode: "off"` anyway — no agent runs there regardless — but this constant
  // and the column default must not disagree, or an org would silently lose
  // capabilities the moment its first settings row was written.
  agentCapabilityCeiling: [...AGENT_CAPABILITIES],
};

export async function readOrgAiSettings(
  client: SupabaseClient<Database>,
  orgId: string,
): Promise<OrgAiSettings> {
  const { data, error } = await client
    .from("org_ai_settings")
    .select(
      "ai_mode, tier, monthly_credit_limit, byo_provider, byo_key_last4, default_provider, default_model_id, max_agents_per_user, max_agent_runs_per_user_per_day, agent_capability_ceiling",
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
    // The column is NOT NULL with a default, so the coalesce is unreachable
    // through any supported path — and it clamps CLOSED rather than open on
    // purpose: an unreadable ceiling is not a reason to hand an agent the
    // whole vocabulary. The cast narrows `text[]` to the vocabulary, which
    // `org_ai_settings_ceiling_known` is what actually enforces.
    agentCapabilityCeiling:
      (data.agent_capability_ceiling as AgentCapability[] | null) ?? [],
  };
}
