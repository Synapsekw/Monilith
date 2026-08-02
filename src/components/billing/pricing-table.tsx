"use client";
import { useState } from "react";
import { BillingCadenceToggle } from "./billing-cadence-toggle";
import { PricingTierCard } from "./pricing-tier-card";
import { PRICING_TIERS, type Cadence } from "@/lib/billing/tiers";

/**
 * Toggle + three cards. Client, because the cadence lives in `useState`.
 *
 * Importing PricingTierCard from a "use client" module pulls it into the client
 * bundle too — that is how the boundary works, and it is accepted here: the
 * card is pure presentation over props, fetches nothing, and re-rendering three
 * of them on a toggle is exactly the interaction. The comparison table and FAQ
 * are deliberately mounted by the PAGE rather than nested here, so they stay
 * Server Components and never ship.
 *
 * Zero server round-trips on toggle, per working agreement #5.
 */
export function PricingTable() {
  const [cadence, setCadence] = useState<Cadence>("annual");

  return (
    <>
      <div className="flex justify-center">
        <BillingCadenceToggle value={cadence} onChange={setCadence} />
      </div>
      <div className="mt-12 grid gap-5 md:grid-cols-3">
        {PRICING_TIERS.map((t) => (
          <PricingTierCard key={t.id} tier={t} cadence={cadence} />
        ))}
      </div>
    </>
  );
}
