/**
 * The billing → entitlement mapping, as pure functions.
 *
 * Deliberately free of I/O and of `server-only`, so the Stripe webhook (Unit C),
 * the settings guard, and unit tests can all share one definition. The
 * entitlement GATE is not here — `requireAiEntitlement` already fails closed on
 * `ai_mode = 'off'`. This module decides what the subscription implies; nothing
 * here reads or writes anything.
 *
 * The allowance comes from `tiers.ts`, which is the published price list and
 * therefore the place that number is actually decided. Restating it here would
 * let the page advertise one figure while the ceiling enforced another.
 */
import { CREDITS_PER_SEAT } from "@/lib/billing/tiers";

export type BillingTier = "none" | "core" | "pulse" | "trial" | "enterprise";

export type BillingStatus =
  | "none"
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "grace";

/** The flat org-wide grant a 14-day trial carries — not multiplied by seats. */
export const TRIAL_CREDIT_GRANT = CREDITS_PER_SEAT;

/**
 * Sentinel for "this tier's ceiling is negotiated — do not recompute it".
 * Callers MUST check for it before writing `monthly_credit_limit`; writing -1
 * into the column would make `creditsRemaining` negative and hard-stop the org.
 */
export const CREDIT_LIMIT_UNMANAGED = -1;

const ENTITLING: readonly BillingStatus[] = ["trialing", "active", "past_due"];

/**
 * Does this subscription status entitle managed AI?
 *
 * `past_due` says yes on purpose: Stripe's retry schedule runs for days, and
 * revoking AI on the first declined charge punishes a customer whose card
 * merely expired. `grace` says no — grace is the post-cancellation read-only
 * window, where non-AI features keep working and AI does not.
 */
export function entitlesAi(status: BillingStatus): boolean {
  return ENTITLING.includes(status);
}

/**
 * The monthly credit ceiling a tier implies.
 *
 * Returns `CREDIT_LIMIT_UNMANAGED` for Enterprise — see that constant.
 */
export function creditLimitFor(tier: BillingTier, seats: number): number {
  switch (tier) {
    case "pulse":
      // Truncate before multiplying: a fractional seat count must not produce a
      // fractional ceiling, and a negative one must not produce a negative pool.
      return Math.max(0, Math.trunc(seats)) * CREDITS_PER_SEAT;
    case "trial":
      return TRIAL_CREDIT_GRANT;
    case "enterprise":
      return CREDIT_LIMIT_UNMANAGED;
    case "core":
    case "none":
      return 0;
  }
}
