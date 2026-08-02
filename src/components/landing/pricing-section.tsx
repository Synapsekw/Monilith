import Link from "next/link";
import { Container, SectionHead } from "./sections/primitives";
import { LandingReveal } from "./landing-reveal";
import { Kicker } from "@/components/ui/kicker";
import { PRICING_TIERS, priceFor } from "@/lib/billing/tiers";

/**
 * Compact three-card pricing teaser for the landing page. A Server Component:
 * no cadence toggle here on purpose — the teaser shows the annual (headline)
 * rate and sends anyone who wants to compare to /pricing, which keeps the
 * landing page's client bundle unchanged.
 *
 * A new file rather than another section inside landing-sections.tsx, which is
 * at ~837 lines against a deliberately-retained 800-line max-lines tripwire
 * whose whole purpose is keeping god-file accretion visible.
 */
export function LandingPricingSection() {
  return (
    <section id="pricing" className="py-24 sm:py-32">
      <Container>
        <SectionHead
          center
          kicker="Pricing"
          title="Pay for the seats you use"
          sub="No seat minimum, no bucket jumps. Every plan starts with a 14-day free trial of Pulse."
        />

        <div className="mt-14 grid gap-5 md:grid-cols-3">
          {PRICING_TIERS.map((tier, i) => {
            const price = priceFor(tier, "annual");
            return (
              <LandingReveal key={tier.id} delayMs={i * 80}>
                <div
                  className={`bg-surface flex h-full flex-col rounded-lg border p-5 ${
                    tier.highlight ? "border-border-bright" : "border-border"
                  }`}
                >
                  <Kicker>{tier.name}</Kicker>
                  <div className="mt-3 flex items-baseline gap-1.5">
                    {price === null ? (
                      <span className="text-3xl font-extrabold tracking-tight">
                        Custom
                      </span>
                    ) : (
                      <>
                        <span className="text-3xl font-extrabold tracking-tight">
                          ${price}
                        </span>
                        <span className="text-muted-foreground text-xs">
                          per user / month
                        </span>
                      </>
                    )}
                  </div>
                  <p className="text-muted-foreground mt-2.5 text-[13.5px] leading-relaxed">
                    {tier.tagline}
                  </p>
                </div>
              </LandingReveal>
            );
          })}
        </div>

        <div className="mt-10 text-center">
          <Link
            href="/pricing"
            className="border-border hover:border-border-hover focus-visible:ring-ring ease-keystone inline-flex items-center justify-center rounded-lg border px-5 py-2.5 text-sm font-semibold transition-colors duration-300 focus-visible:ring-2 focus-visible:outline-none pointer-coarse:min-h-11"
          >
            Compare plans →
          </Link>
        </div>
      </Container>
    </section>
  );
}
