import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { nunito } from "@/lib/fonts";
import { PricingTable } from "@/components/billing/pricing-table";
import { PricingComparison } from "@/components/billing/pricing-comparison";
import { PricingFaq } from "@/components/billing/pricing-faq";

export const metadata: Metadata = {
  title: "Pricing · Monolith",
  description:
    "Monolith pricing — Core at $10 per user per month for the whole Work OS, Pulse at $24 with AI agents and 500 pooled credits per seat. No seat minimum.",
};

/**
 * Public, unauthenticated, fully static.
 *
 * No `searchParams` is read here on purpose: awaiting searchParams at page
 * level fails `next build` under cacheComponents ("Uncached data outside
 * <Suspense>") while typecheck, lint and unit tests all pass. The cadence is
 * client state, so nothing is needed from the URL.
 *
 * Wrapped in `dark` so Keystone tokens resolve to the always-dark marketing
 * aesthetic regardless of the visitor's theme, matching /updates and /landing.
 */
export default function PricingPage() {
  return (
    <div className="dark bg-background text-foreground min-h-dvh">
      <div className="mx-auto max-w-[1100px] px-6 py-20 sm:px-8">
        <Link
          href="/landing"
          className="text-muted-foreground hover:text-foreground mb-12 inline-flex items-center gap-1.5 text-sm transition-colors"
        >
          <ArrowLeft className="size-4" />
          Back to home
        </Link>

        <header className="mx-auto mb-12 max-w-[640px] text-center">
          <h1
            className={`${nunito.className} text-4xl font-extrabold tracking-tight sm:text-5xl`}
          >
            Pay for the seats you use
          </h1>
          <p className="text-muted-foreground mt-4 text-base leading-relaxed sm:text-lg">
            No seat minimum, no bucket jumps. Every plan starts with a 14-day
            free trial of Pulse.
          </p>
        </header>

        <PricingTable />
        <PricingComparison />
        <PricingFaq />
      </div>
    </div>
  );
}
