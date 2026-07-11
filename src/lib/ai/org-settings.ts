import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { AiProvider } from "@/lib/ai/providers/catalog";

export type AiMode = Database["public"]["Enums"]["ai_mode"];

export type OrgAiSettings = {
  mode: AiMode;
  tier: string;
  monthlyCreditLimit: number;
  byoProvider: AiProvider | null;
  byoKeyLast4: string | null;
};

/** A missing org_ai_settings row means the shipped default: members' own keys. */
export const DEFAULT_ORG_AI_SETTINGS: OrgAiSettings = {
  mode: "per_user",
  tier: "none",
  monthlyCreditLimit: 0,
  byoProvider: null,
  byoKeyLast4: null,
};

export async function readOrgAiSettings(
  client: SupabaseClient<Database>,
  orgId: string,
): Promise<OrgAiSettings> {
  const { data, error } = await client
    .from("org_ai_settings")
    .select("ai_mode, tier, monthly_credit_limit, byo_provider, byo_key_last4")
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
  };
}
