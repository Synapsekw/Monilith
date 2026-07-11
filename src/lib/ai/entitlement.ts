import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { AiDisabledError, AiQuotaExceededError } from "@/lib/ai/errors";
import { readOrgAiSettings, type AiMode } from "@/lib/ai/org-settings";

export type AiEntitlement = {
  mode: AiMode;
  tier: string;
  creditsLimit: number;
  creditsUsed: number;
  creditsRemaining: number;
};

export async function getAiEntitlement(orgId: string): Promise<AiEntitlement> {
  const svc = createServiceClient();
  const settings = await readOrgAiSettings(svc, orgId);
  if (settings.mode !== "managed") {
    return {
      mode: settings.mode,
      tier: settings.tier,
      creditsLimit: settings.monthlyCreditLimit,
      creditsUsed: 0,
      creditsRemaining: Infinity,
    };
  }
  const { data, error } = await svc.rpc("ai_credits_used_this_month", {
    p_org: orgId,
  });
  if (error) throw error;
  const used = Number(data ?? 0);
  return {
    mode: "managed",
    tier: settings.tier,
    creditsLimit: settings.monthlyCreditLimit,
    creditsUsed: used,
    creditsRemaining: Math.max(0, settings.monthlyCreditLimit - used),
  };
}

/** Gate every AI Server Action BEFORE doing any work. Fails closed with typed errors. */
export async function requireAiEntitlement(
  orgId: string,
  _feature: string,
): Promise<void> {
  const entitlement = await getAiEntitlement(orgId);
  if (entitlement.mode === "off") throw new AiDisabledError();
  if (entitlement.mode === "managed" && entitlement.creditsRemaining <= 0) {
    throw new AiQuotaExceededError();
  }
}
