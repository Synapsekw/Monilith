import { describe, expect, it } from "vitest";
import {
  applyRateFloor,
  computeCostUsd,
  costToCredits,
  ratesForModel,
  type ModelRates,
} from "@/lib/ai/pricing";

const SONNET: ModelRates = {
  input: 3,
  output: 15,
  cacheRead: null,
  cacheWrite: null,
};

describe("computeCostUsd", () => {
  it("bills input and output at the supplied rates", () => {
    expect(
      computeCostUsd(SONNET, { inputTokens: 1_000_000, outputTokens: 0 }),
    ).toBeCloseTo(3, 9);
    expect(
      computeCostUsd(SONNET, { inputTokens: 0, outputTokens: 1_000_000 }),
    ).toBeCloseTo(15, 9);
  });

  it("falls back to the Anthropic multipliers when a provider publishes no cache rate", () => {
    // 0.1x input for reads, 1.25x for writes — preserves today's billing
    // exactly for any model whose feed entry omits cache pricing.
    expect(
      computeCostUsd(SONNET, {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 1_000_000,
      }),
    ).toBeCloseTo(0.3, 9);
    expect(
      computeCostUsd(SONNET, {
        inputTokens: 0,
        outputTokens: 0,
        cacheWriteTokens: 1_000_000,
      }),
    ).toBeCloseTo(3.75, 9);
  });

  it("prefers an explicit cache rate over the multiplier", () => {
    const explicit: ModelRates = {
      input: 3,
      output: 15,
      cacheRead: 0.5,
      cacheWrite: 6,
    };
    expect(
      computeCostUsd(explicit, {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 1_000_000,
      }),
    ).toBeCloseTo(0.5, 9);
  });

  it("costs 0 for null rates but does not throw", () => {
    expect(
      computeCostUsd(null, { inputTokens: 1000, outputTokens: 1000 }),
    ).toBe(0);
  });
});

describe("ratesForModel", () => {
  it("serves the seeded floor for a known model", () => {
    expect(ratesForModel("claude-sonnet-5")).toEqual({
      input: 3,
      output: 15,
      cacheRead: null,
      cacheWrite: null,
    });
  });

  it("returns null for an unknown model", () => {
    expect(ratesForModel("kimi-k2")).toBeNull();
  });

  it("returns null for Object.prototype property names, not the inherited function", () => {
    // FALLBACK_RATES is an object literal, so a naive `FALLBACK_RATES[model] ?? null`
    // lookup returns Object.prototype's members for these ids — all truthy
    // functions, which would sail past computeCostUsd's `if (!rates)` guard.
    expect(ratesForModel("constructor")).toBeNull();
    expect(ratesForModel("toString")).toBeNull();
    expect(ratesForModel("valueOf")).toBeNull();
    expect(ratesForModel("hasOwnProperty")).toBeNull();
  });

  it("prices the embedding model input-only ($0.02/MTok, output ignored)", () => {
    const rates = ratesForModel("text-embedding-3-small");
    expect(
      computeCostUsd(rates, { inputTokens: 1_000_000, outputTokens: 0 }),
    ).toBeCloseTo(0.02, 9);
    // output tokens carry a 0 rate — they never add cost even if present.
    expect(
      computeCostUsd(rates, { inputTokens: 500_000, outputTokens: 999 }),
    ).toBeCloseTo(0.01, 9);
  });
});

describe("applyRateFloor", () => {
  it("uses the floor verbatim when the catalog published no usable price", () => {
    expect(applyRateFloor("claude-sonnet-5", null)).toEqual(SONNET);
  });

  it("bills nothing only when the model is in neither source", () => {
    expect(applyRateFloor("kimi-k2", null)).toBeNull();
  });

  it("floors each component independently", () => {
    // Input is below the floor and is raised; output is above it and is kept.
    expect(
      applyRateFloor("claude-sonnet-5", {
        input: 2,
        output: 20,
        cacheRead: null,
        cacheWrite: null,
      }),
      // closeTo, not 0.3: the derived rate is 3 * 0.1, which in IEEE-754 is
      // 0.30000000000000004. computeCostUsd derives the identical value from a
      // null, so this is a float artefact and not a pricing difference.
    ).toEqual({
      input: 3,
      output: 20,
      cacheRead: expect.closeTo(0.3, 9),
      cacheWrite: 3.75,
    });
  });

  it("pins sonnet 5 to its STANDARD rate against the introductory price", () => {
    // Anthropic's $2/$10 promo expires 2026-08-31. Billing it would cliff every
    // user's costs the day it ends, so the floor holds $3/$15 regardless of
    // what the Gateway feed publishes. Do not relax this without a decision.
    const feed: ModelRates = {
      input: 2,
      output: 10,
      cacheRead: null,
      cacheWrite: null,
    };
    expect(applyRateFloor("claude-sonnet-5", feed)).toMatchObject({
      input: 3,
      output: 15,
    });
  });

  it("pins sonnet 5's CACHE rates against the introductory price too", () => {
    // The component that matters most: a tool loop is mostly cache reads, so a
    // floor that stopped at input/output would leave the cliff in place on the
    // biggest line item. The promo's 0.20/2.50 must be lifted to the 0.30/3.75
    // that the floored $3 input implies.
    expect(
      applyRateFloor("claude-sonnet-5", {
        input: 2,
        output: 10,
        cacheRead: 0.2,
        cacheWrite: 2.5,
      }),
    ).toEqual({
      input: 3,
      output: 15,
      cacheRead: expect.closeTo(0.3, 9),
      cacheWrite: 3.75,
    });
  });

  it("floors the CACHE components too, at the derived rate", () => {
    // The floor's own cacheRead/cacheWrite are null for every model in the
    // table, so stopping at `max(catalog, floor.cacheRead)` would take any
    // published cache price verbatim — see the sonnet promo test below.
    const floored = applyRateFloor("claude-haiku-4-5", {
      input: 1,
      output: 5,
      cacheRead: 0.02,
      cacheWrite: null,
    });
    expect(floored).toEqual({
      input: 1,
      output: 5,
      cacheRead: 0.1, // raised from 0.02 to 1 x 0.1
      cacheWrite: 1.25, // materialised at 1 x 1.25
    });
  });

  it("materialising a null cache rate does not change what it costs", () => {
    // A null cache component is billed by computeCostUsd at input x 0.1 /
    // x 1.25. Turning that into an explicit number must be a no-op, otherwise
    // this fix would quietly reprice every model in the table.
    const usage = {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 1_000_000,
      cacheWriteTokens: 1_000_000,
    };
    const nullCache: ModelRates = {
      input: 3,
      output: 15,
      cacheRead: null,
      cacheWrite: null,
    };
    expect(
      computeCostUsd(applyRateFloor("claude-sonnet-5", nullCache), usage),
    ).toBeCloseTo(computeCostUsd(nullCache, usage), 9);
  });

  it("derives the cache floor from the FLOORED input, so a price rise lifts it", () => {
    // Deriving from the table's own input instead would pin cache reads at
    // 0.30 while this model's risen input implies 0.40 — a cut, not a floor.
    expect(
      applyRateFloor("claude-sonnet-5", {
        input: 4,
        output: 20,
        cacheRead: null,
        cacheWrite: null,
      }),
    ).toEqual({ input: 4, output: 20, cacheRead: 0.4, cacheWrite: 5 });
  });

  it("keeps a published cache rate that already exceeds the derived floor", () => {
    // gpt-4o's real cached-input price is 0.5x input, far above 0.1x — the
    // derived floor must not touch it.
    expect(
      applyRateFloor("gpt-4o", {
        input: 2.5,
        output: 10,
        cacheRead: 1.25,
        cacheWrite: null,
      }),
    ).toMatchObject({ cacheRead: 1.25 });
  });

  it("passes an unknown model's catalog rates through untouched", () => {
    const kimi: ModelRates = {
      input: 0.6,
      output: 2.5,
      cacheRead: 0.15,
      cacheWrite: null,
    };
    expect(applyRateFloor("kimi-k2", kimi)).toEqual(kimi);
  });

  it("does not treat Object.prototype names as floored models", () => {
    expect(applyRateFloor("constructor", null)).toBeNull();
  });
});

describe("costToCredits", () => {
  it("converts 1 USD to 100 credits", () => {
    expect(costToCredits(1)).toBe(100);
  });

  it("rounds to 2 decimal places", () => {
    expect(costToCredits(0.0225)).toBe(2.25);
    expect(costToCredits(0.02255)).toBe(2.26); // half-up
    expect(costToCredits(0)).toBe(0);
  });
});
