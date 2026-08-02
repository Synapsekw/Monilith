import { describe, it, expect } from "vitest";
import { PRICING_TIERS, priceFor, CREDITS_PER_SEAT } from "@/lib/billing/tiers";

const core = PRICING_TIERS.find((t) => t.id === "core")!;
const pulse = PRICING_TIERS.find((t) => t.id === "pulse")!;
const enterprise = PRICING_TIERS.find((t) => t.id === "enterprise")!;

describe("PRICING_TIERS", () => {
  it("carries the three published tiers, with Pulse highlighted", () => {
    expect(PRICING_TIERS).toHaveLength(3);
    expect(pulse.highlight).toBe(true);
    expect(core.highlight).toBe(false);
    expect(enterprise.highlight).toBe(false);
  });

  it("highlights exactly one tier", () => {
    expect(PRICING_TIERS.filter((t) => t.highlight)).toHaveLength(1);
  });

  it("prices annual as two months free relative to monthly", () => {
    // The $10-vs-$12 and $24-vs-$29 spread IS the annual discount — there is no
    // separate coupon to administer. 12 x annual must equal 10 x monthly.
    expect(core.annual! * 12).toBe(core.monthly! * 10);
    expect(pulse.annual).toBe(24);
    expect(pulse.monthly).toBe(29);
  });

  it("leaves Enterprise unpriced", () => {
    expect(enterprise.monthly).toBeNull();
    expect(priceFor(enterprise, "annual")).toBeNull();
  });

  it("states the credit allowance in Pulse's features, matching the constant", () => {
    expect(CREDITS_PER_SEAT).toBe(500);
    expect(
      pulse.features.some((f) => f.includes(String(CREDITS_PER_SEAT))),
    ).toBe(true);
  });

  it("never claims Core includes AI", () => {
    expect(core.features.some((f) => /\bAI\b/.test(f))).toBe(false);
  });
});

describe("priceFor", () => {
  it("returns the cadence's price", () => {
    expect(priceFor(core, "monthly")).toBe(12);
    expect(priceFor(core, "annual")).toBe(10);
  });
});
