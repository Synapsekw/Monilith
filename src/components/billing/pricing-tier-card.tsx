import Link from "next/link";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Kicker } from "@/components/ui/kicker";
import { StatusPill } from "@/components/ui/status-pill";
import { priceFor, type Cadence, type PricingTier } from "@/lib/billing/tiers";

/**
 * One tier.
 *
 * No directive of its own: it is imported by `pricing-table.tsx` ("use client")
 * and so ships to the client. That is fine — it is pure presentation over props
 * and fetches nothing. Keep it that way; a server-only import here would break
 * the client build of the pricing page.
 *
 * The highlighted tier is marked with a "Most popular" pill as well as a
 * brightened hairline: never colour alone. Keystone says elevation is surface
 * steps and hairlines, so there is no shadow and no lift — this card is a
 * container, not an interactive target.
 */
export function PricingTierCard({
  tier,
  cadence,
}: {
  tier: PricingTier;
  cadence: Cadence;
}) {
  const price = priceFor(tier, cadence);

  return (
    <div
      className={cn(
        "bg-surface flex h-full flex-col rounded-lg border p-6",
        tier.highlight ? "border-border-bright" : "border-border",
      )}
    >
      <div className="flex min-h-6 items-center justify-between gap-3">
        <Kicker>{tier.name}</Kicker>
        {tier.highlight ? (
          <StatusPill color="primary" variant="soft">
            Most popular
          </StatusPill>
        ) : null}
      </div>

      <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
        {tier.tagline}
      </p>

      <div className="mt-6 mb-1 flex items-baseline gap-1.5">
        {price === null ? (
          <span className="text-4xl font-extrabold tracking-tight">Custom</span>
        ) : (
          <>
            <span className="text-4xl font-extrabold tracking-tight">
              ${price}
            </span>
            <span className="text-muted-foreground text-sm">
              per user / month
            </span>
          </>
        )}
      </div>
      {/* Reserved line, so the three cards' feature lists stay aligned whether
          or not the cadence note renders. */}
      <p className="text-muted-foreground min-h-5 text-xs">
        {price !== null && cadence === "annual" ? "Billed annually" : " "}
      </p>

      <ul className="mt-6 mb-8 flex flex-1 flex-col gap-2.5">
        {tier.features.map((f) => (
          <li key={f} className="flex items-start gap-2.5 text-sm">
            <Check
              className="text-primary mt-0.5 size-4 flex-none"
              aria-hidden="true"
            />
            <span>{f}</span>
          </li>
        ))}
      </ul>

      <Button
        asChild
        variant={tier.highlight ? "default" : "outline"}
        className="h-10 w-full"
      >
        <Link href={tier.ctaHref}>{tier.ctaLabel}</Link>
      </Button>
    </div>
  );
}
