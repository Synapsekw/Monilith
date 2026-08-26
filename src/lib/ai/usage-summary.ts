import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { typedRpc } from "@/lib/supabase/typed-rpc";
import { getAiEntitlement, type AiEntitlement } from "@/lib/ai/entitlement";

export type UsageSummary = {
  entitlement: {
    mode: AiEntitlement["mode"];
    tier: string;
    creditsUsed: number;
    /** null = unmetered (org_byo/per_user/off — getAiEntitlement returns Infinity there). */
    creditsLimit: number | null;
  };
  months: { month: string; credits: number; costUsd: number; calls: number }[];
  features: { feature: string; credits: number; calls: number }[];
};

/**
 * Bounded usage read for the /settings/ai admin card: a 6-month rollup
 * (current month + 5 prior) plus this month's per-feature breakdown, both
 * scanning ai_usage_org_created_idx with an explicit window — no unbounded
 * select. `creditsLimit` mirrors managed mode's ceiling; org_byo/per_user/off
 * are unmetered (getAiEntitlement's creditsRemaining is Infinity there),
 * coerced to null because Infinity does not survive JSON serialization.
 */
export async function getUsageSummary(orgId: string): Promise<UsageSummary> {
  const svc = createServiceClient();
  const now = new Date();
  const from = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1),
  );
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  const [entitlement, monthsRes, featuresRes] = await Promise.all([
    getAiEntitlement(orgId),
    typedRpc(svc, "ai_usage_summary", {
      p_org: orgId,
      p_from: from.toISOString(),
      p_to: to.toISOString(),
    }),
    typedRpc(svc, "ai_usage_by_feature_this_month", { p_org: orgId }),
  ]);
  if (monthsRes.error) throw monthsRes.error;
  if (featuresRes.error) throw featuresRes.error;

  return {
    entitlement: {
      mode: entitlement.mode,
      tier: entitlement.tier,
      creditsUsed: entitlement.creditsUsed,
      creditsLimit: Number.isFinite(entitlement.creditsRemaining)
        ? entitlement.creditsLimit
        : null,
    },
    months: (monthsRes.data ?? []).map((r) => ({
      month: r.month as string,
      credits: Number(r.credits),
      costUsd: Number(r.cost_usd),
      calls: r.calls,
    })),
    features: (featuresRes.data ?? []).map((r) => ({
      feature: r.feature as string,
      credits: Number(r.credits),
      calls: r.calls,
    })),
  };
}
