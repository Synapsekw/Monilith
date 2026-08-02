import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { BillingStatus, BillingTier } from "@/lib/billing/entitling";

export type OrgBillingStatus = {
  tier: BillingTier;
  status: BillingStatus;
  cadence: "monthly" | "annual" | null;
  seats: number;
  currentPeriodEnd: string | null;
  trialEndsAt: string | null;
  graceEndsAt: string | null;
};

/** What an org with no subscription looks like. Never null, so callers don't branch. */
export const NO_BILLING: OrgBillingStatus = {
  tier: "none",
  status: "none",
  cadence: null,
  seats: 0,
  currentPeriodEnd: null,
  trialEndsAt: null,
  graceEndsAt: null,
};

/**
 * Read the calling org's own billing state.
 *
 * Goes through the RLS client on purpose: `get_org_billing_status` is
 * SECURITY DEFINER over a deny-all table and does its own membership check, so
 * calling it with the SERVICE client would bypass that check and read any org's
 * row. The one place that legitimately needs cross-org reads is the platform
 * admin console (Unit H), which gets its own definer gated on
 * `is_platform_admin()`.
 *
 * One bounded round trip, primary-key lookup. Working agreement #5.
 */
export async function readOrgBillingStatus(
  orgId: string,
): Promise<OrgBillingStatus> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_org_billing_status", {
    p_org: orgId,
  });
  if (error) throw error;
  const row = data?.[0];
  if (!row) return NO_BILLING;
  return {
    tier: row.tier as BillingTier,
    status: row.status as BillingStatus,
    cadence: (row.cadence as "monthly" | "annual" | null) ?? null,
    seats: row.seats ?? 0,
    currentPeriodEnd: row.current_period_end,
    trialEndsAt: row.trial_ends_at,
    graceEndsAt: row.grace_ends_at,
  };
}
