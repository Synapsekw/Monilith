/**
 * The published price list. Plain data, no React and no `server-only`, so the
 * pricing page, the landing teaser, `entitling.ts`, and (later) the checkout
 * action all read one definition instead of four drifting copies.
 *
 * ZERO IMPORTS, deliberately: this module is the leaf of the billing graph.
 * `entitling.ts` imports CREDITS_PER_SEAT from here, so an import in the other
 * direction would be a cycle.
 *
 * Prices are per user per month in USD. Annual is billed yearly at the annual
 * rate; the $10-vs-$12 and $24-vs-$29 spread IS the "two months free" discount,
 * not a separate coupon to administer.
 */

export type Cadence = "monthly" | "annual";

/**
 * The Pulse allowance, pooled org-wide. 500 credits = $5 of our spend at the
 * shipped 1 credit = $0.01 convention — deliberately well above expected use
 * and well below the $14 AI price delta, which is the only configuration that
 * is both generous-feeling and safe.
 *
 * Lives here rather than in entitling.ts because it is a PRICING decision, and
 * the pricing page advertises it. One definition means the page cannot promise
 * a number the ceiling does not enforce.
 */
export const CREDITS_PER_SEAT = 500;

export type PricingTier = {
  id: "core" | "pulse" | "enterprise";
  name: string;
  tagline: string;
  /** USD per user per month, billed monthly. `null` = talk to us. */
  monthly: number | null;
  /** USD per user per month, billed annually. `null` = talk to us. */
  annual: number | null;
  features: readonly string[];
  /** Exactly one tier is highlighted — the one we want chosen. */
  highlight: boolean;
  ctaLabel: string;
  ctaHref: string;
};

export const PRICING_TIERS: readonly PricingTier[] = [
  {
    id: "core",
    name: "Core",
    tagline: "The whole Work OS. No AI.",
    monthly: 12,
    annual: 10,
    features: [
      "Unlimited boards, items, and workspaces",
      "Table, kanban, calendar, and timeline views",
      "Automations, dashboards, and reports",
      "Portfolios, goals, workload, and time tracking",
      "Import and export, board sharing, guests",
      "No seat minimum — pay for the seats you use",
    ],
    highlight: false,
    ctaLabel: "Start free trial",
    ctaHref: "/signup",
  },
  {
    id: "pulse",
    name: "Pulse",
    tagline: "Everything in Core, plus the agents.",
    monthly: 29,
    annual: 24,
    features: [
      "Everything in Core",
      "Ask Pulse across your whole workspace",
      "Personal agents and daily briefings",
      "AI board, dashboard, and automation generation",
      "Semantic search",
      `${CREDITS_PER_SEAT} AI credits per seat per month, pooled org-wide`,
    ],
    highlight: true,
    ctaLabel: "Start free trial",
    ctaHref: "/signup",
  },
  {
    id: "enterprise",
    name: "Enterprise",
    tagline: "For teams with their own rules.",
    monthly: null,
    annual: null,
    features: [
      "Everything in Pulse",
      "Custom credit ceiling",
      "SSO",
      "Bring your own model keys by arrangement",
      "Priority support",
    ],
    highlight: false,
    ctaLabel: "Contact us",
    ctaHref: "mailto:info@synapse-solutions.ai?subject=Monolith%20Enterprise",
  },
];

export function priceFor(tier: PricingTier, cadence: Cadence): number | null {
  return cadence === "annual" ? tier.annual : tier.monthly;
}
