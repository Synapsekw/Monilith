import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PricingTierCard } from "./pricing-tier-card";
import { PRICING_TIERS } from "@/lib/billing/tiers";

const core = PRICING_TIERS.find((t) => t.id === "core")!;
const pulse = PRICING_TIERS.find((t) => t.id === "pulse")!;
const enterprise = PRICING_TIERS.find((t) => t.id === "enterprise")!;

describe("PricingTierCard", () => {
  it("shows the cadence's price and says what it is per", () => {
    render(<PricingTierCard tier={core} cadence="annual" />);
    expect(screen.getByText("$10")).toBeInTheDocument();
    expect(screen.getByText(/per user \/ month/i)).toBeInTheDocument();
  });

  it("shows the monthly price when the cadence is monthly", () => {
    render(<PricingTierCard tier={core} cadence="monthly" />);
    expect(screen.getByText("$12")).toBeInTheDocument();
  });

  it("says 'billed annually' only on the annual cadence", () => {
    const { rerender } = render(
      <PricingTierCard tier={pulse} cadence="annual" />,
    );
    expect(screen.getByText(/billed annually/i)).toBeInTheDocument();
    rerender(<PricingTierCard tier={pulse} cadence="monthly" />);
    expect(screen.queryByText(/billed annually/i)).not.toBeInTheDocument();
  });

  it("renders 'Custom' instead of a price for an unpriced tier", () => {
    render(<PricingTierCard tier={enterprise} cadence="annual" />);
    // Exact, not /custom/i — "Custom credit ceiling" is also a feature row.
    expect(screen.getByText("Custom")).toBeInTheDocument();
    expect(screen.queryByText(/per user \/ month/i)).not.toBeInTheDocument();
  });

  it("labels the highlighted tier in text, not colour alone", () => {
    render(<PricingTierCard tier={pulse} cadence="annual" />);
    expect(screen.getByText(/most popular/i)).toBeInTheDocument();
  });

  it("does not label a non-highlighted tier", () => {
    render(<PricingTierCard tier={core} cadence="annual" />);
    expect(screen.queryByText(/most popular/i)).not.toBeInTheDocument();
  });

  it("renders every feature", () => {
    render(<PricingTierCard tier={pulse} cadence="annual" />);
    for (const f of pulse.features) {
      expect(screen.getByText(f)).toBeInTheDocument();
    }
  });

  it("renders the CTA as a link to the tier's destination", () => {
    render(<PricingTierCard tier={enterprise} cadence="annual" />);
    const cta = screen.getByRole("link", { name: enterprise.ctaLabel });
    expect(cta).toHaveAttribute("href", enterprise.ctaHref);
  });
});
