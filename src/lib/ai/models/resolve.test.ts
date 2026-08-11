import { describe, expect, it } from "vitest";
import { pickModel, resolveModel } from "@/lib/ai/models/resolve";
import type { ModelRow } from "@/lib/ai/models/catalog-db";
import { FALLBACK_RATES } from "@/lib/ai/pricing";
import { fakeAiModelsClient } from "@/test/ai-models-fake-client";

function row(over: Partial<ModelRow>): ModelRow {
  return {
    provider: "anthropic",
    modelId: "claude-sonnet-5",
    // Null is the honest default: a row is unverified until Task 4a's
    // verifier confirms the provider-native id, and `requestModel` must then
    // fall back to the catalog key.
    nativeModelId: null,
    label: "Sonnet 5",
    contextLength: 1_000_000,
    maxOutputTokens: 64_000,
    supportsTools: true,
    inputPricePerMtok: 3,
    outputPricePerMtok: 15,
    cacheReadPricePerMtok: null,
    cacheWritePricePerMtok: null,
    tier: "standard",
    status: "active",
    ...over,
  };
}

/**
 * Ordered cheapest input rate first, which is the precondition `pickModel`
 * documents and `listActiveModels` guarantees via its `.order()`.
 *
 * The cheap tier deliberately has TWO members: with one row per tier, "picks
 * the cheapest of the tier" and "picks any row of the tier" are the same
 * assertion, and the ordering precondition is never exercised.
 */
const CATALOG = [
  row({ modelId: "claude-mini-1", tier: "cheap", inputPricePerMtok: 0.5 }),
  row({ modelId: "claude-haiku-4-5", tier: "cheap", inputPricePerMtok: 1 }),
  row({ modelId: "claude-sonnet-5", tier: "standard", inputPricePerMtok: 3 }),
  row({ modelId: "claude-opus-4-8", tier: "strong", inputPricePerMtok: 5 }),
];

describe("pickModel", () => {
  it("uses the pinned model when it is active", () => {
    const r = pickModel({
      active: CATALOG,
      requested: "claude-opus-4-8",
      orgDefaultModelId: "claude-sonnet-5",
      tier: "standard",
    });
    expect(r.model).toBe("claude-opus-4-8");
    expect(r.substituted).toBe(false);
  });

  it("substitutes the org default when the pinned model is gone, and FLAGS it", () => {
    const r = pickModel({
      active: CATALOG,
      requested: "claude-retired-9",
      orgDefaultModelId: "claude-sonnet-5",
      tier: "standard",
    });
    expect(r.model).toBe("claude-sonnet-5");
    // The run must still produce output — a retirement you did not notice must
    // not silently stop a scheduled agent.
    expect(r.substituted).toBe(true);
  });

  it("uses the org default when nothing is pinned", () => {
    const r = pickModel({
      active: CATALOG,
      requested: null,
      orgDefaultModelId: "claude-sonnet-5",
      tier: "cheap",
    });
    expect(r.model).toBe("claude-sonnet-5");
    expect(r.substituted).toBe(false);
  });

  it("falls back to the cheapest model of the requested tier when no default is set", () => {
    const r = pickModel({
      active: CATALOG,
      requested: null,
      orgDefaultModelId: null,
      tier: "cheap",
    });
    // The CHEAPER of the two cheap-tier rows, not merely a cheap-tier row.
    expect(r.model).toBe("claude-mini-1");
    expect(r.model).not.toBe("claude-haiku-4-5");
  });

  it("respects the cheapest-first ordering rather than re-sorting", () => {
    // `pickModel` takes the ordering as a precondition (listActiveModels
    // supplies it). Hand it a mis-ordered array and the first matching row
    // wins — proving the contract is the ORDER, so a dropped `.order()` in
    // catalog-db would change which model every unpinned org runs on.
    const r = pickModel({
      active: [CATALOG[1], CATALOG[0], CATALOG[2], CATALOG[3]],
      requested: null,
      orgDefaultModelId: null,
      tier: "cheap",
    });
    expect(r.model).toBe("claude-haiku-4-5");
  });

  it("falls back to the overall cheapest when the tier has no members", () => {
    const r = pickModel({
      active: [
        row({ modelId: "only-one", tier: "strong", inputPricePerMtok: 9 }),
      ],
      requested: null,
      orgDefaultModelId: null,
      tier: "cheap",
    });
    expect(r.model).toBe("only-one");
  });

  it("returns null when the provider has no active models at all", () => {
    const r = pickModel({
      active: [],
      requested: "anything",
      orgDefaultModelId: "also-anything",
      tier: "cheap",
    });
    expect(r.model).toBeNull();
    expect(r.requestModel).toBeNull();
  });

  it("carries rates and tool support from the chosen row", () => {
    const r = pickModel({
      active: CATALOG,
      requested: "claude-haiku-4-5",
      orgDefaultModelId: null,
      tier: "cheap",
    });
    // cacheRead/cacheWrite are materialised at the floor's derived multipliers
    // (input x 0.1 / x 1.25) — the same numbers computeCostUsd would have
    // derived from a null, so this is the row's price, not a markup.
    expect(r.rates).toEqual({
      input: 1,
      output: 15,
      cacheRead: 0.1,
      cacheWrite: 1.25,
    });
    expect(r.supportsTools).toBe(true);
  });
});

describe("pickModel — the callable id", () => {
  // The Gateway's id namespace is NOT each provider's native namespace: the
  // feed publishes `claude-haiku-4.5` where Anthropic's own API wants a dated
  // snapshot. Sending the catalog key straight to the provider is a 404.
  it("exposes the provider-native id separately from the catalog key", () => {
    const r = pickModel({
      active: [
        row({
          modelId: "claude-haiku-4.5",
          nativeModelId: "claude-haiku-4-5-20251001",
        }),
      ],
      requested: "claude-haiku-4.5",
      orgDefaultModelId: null,
      tier: "cheap",
    });
    // `model` is the catalog key — what a pin references and what the usage
    // ledger records.
    expect(r.model).toBe("claude-haiku-4.5");
    // `requestModel` is what actually goes on the wire.
    expect(r.requestModel).toBe("claude-haiku-4-5-20251001");
  });

  it("falls back to the catalog key when the row is not yet verified", () => {
    const r = pickModel({
      active: [row({ modelId: "gpt-4o", nativeModelId: null })],
      requested: "gpt-4o",
      orgDefaultModelId: null,
      tier: "cheap",
    });
    expect(r.requestModel).toBe("gpt-4o");
  });
});

// ---------------------------------------------------------------------------
// Pricing rules. computeCostUsd bills `null` rates as $0, so every hole here is
// a silently-free model.
// ---------------------------------------------------------------------------

describe("pickModel — rates chain to the fallback floor", () => {
  it("uses the fallback floor when the catalog row carries no price", () => {
    const r = pickModel({
      active: [
        row({
          modelId: "claude-sonnet-5",
          inputPricePerMtok: null,
          outputPricePerMtok: null,
        }),
      ],
      requested: "claude-sonnet-5",
      orgDefaultModelId: null,
      tier: "standard",
    });
    // NOT null: billing $0 for a model the floor knows the price of would be a
    // silent giveaway.
    expect(r.rates).toEqual(FALLBACK_RATES["claude-sonnet-5"]);
  });

  it("bills nothing only when the model is in neither the catalog nor the floor", () => {
    const r = pickModel({
      active: [
        row({
          modelId: "kimi-k2-thinking",
          inputPricePerMtok: null,
          outputPricePerMtok: null,
        }),
      ],
      requested: "kimi-k2-thinking",
      orgDefaultModelId: null,
      tier: "standard",
    });
    expect(r.rates).toBeNull();
  });
});

describe("pickModel — the floor is a per-component MINIMUM", () => {
  // Sonnet 5's introductory $2/$10 expires 2026-08-31. The repo deliberately
  // bills the STANDARD $3/$15 so users do not hit a price cliff the day the
  // promo ends. This test exists so the promo expiring — or the Gateway feed
  // publishing the promo rate — cannot move billing without a failure here.
  it("keeps sonnet 5 at the standard $3/$15 when the feed publishes the promo rate", () => {
    const r = pickModel({
      active: [
        row({
          modelId: "claude-sonnet-5",
          inputPricePerMtok: 2,
          outputPricePerMtok: 10,
          // The promo's cache rates, which the feed already parses
          // (`input_cache_read` / `input_cache_write`). All four components
          // have to clear the floor, not just the first two.
          cacheReadPricePerMtok: 0.2,
          cacheWritePricePerMtok: 2.5,
        }),
      ],
      requested: "claude-sonnet-5",
      orgDefaultModelId: null,
      tier: "standard",
    });
    expect(r.rates).toEqual({
      input: 3,
      output: 15,
      // 3 * 0.1 is 0.30000000000000004 in IEEE-754 — the same value
      // computeCostUsd derives from a null cache rate, so a float artefact
      // rather than a pricing difference.
      cacheRead: expect.closeTo(0.3, 9),
      cacheWrite: 3.75,
    });
  });

  it("applies the same rule to every model in the floor, not just sonnet", () => {
    const r = pickModel({
      active: [
        row({
          modelId: "gemini-2.0-flash",
          inputPricePerMtok: 0.05,
          outputPricePerMtok: 0.2,
        }),
      ],
      requested: "gemini-2.0-flash",
      orgDefaultModelId: null,
      tier: "cheap",
    });
    expect(r.rates?.input).toBe(FALLBACK_RATES["gemini-2.0-flash"].input);
    expect(r.rates?.output).toBe(FALLBACK_RATES["gemini-2.0-flash"].output);
  });

  it("is a floor, not a cap — a price RISE in the feed is honoured", () => {
    const r = pickModel({
      active: [
        row({
          modelId: "claude-sonnet-5",
          inputPricePerMtok: 4,
          outputPricePerMtok: 20,
        }),
      ],
      requested: "claude-sonnet-5",
      orgDefaultModelId: null,
      tier: "standard",
    });
    expect(r.rates).toMatchObject({ input: 4, output: 20 });
  });

  it("leaves a model absent from the floor entirely to the catalog", () => {
    const r = pickModel({
      active: [
        row({
          modelId: "kimi-k2-thinking",
          inputPricePerMtok: 0.6,
          outputPricePerMtok: 2.5,
          cacheReadPricePerMtok: 0.15,
        }),
      ],
      requested: "kimi-k2-thinking",
      orgDefaultModelId: null,
      tier: "cheap",
    });
    expect(r.rates).toEqual({
      input: 0.6,
      output: 2.5,
      cacheRead: 0.15,
      cacheWrite: null,
    });
  });
});

describe("pickModel — unusable catalog prices never reach the ledger", () => {
  // These pin `usablePrice`'s full contract, which is deliberately wider than
  // what a real catalog read can currently deliver:
  //
  //   NaN      — unreachable through the pipeline. `perMtok` (feed-parse) and
  //              `num()` (catalog-db) each map a non-finite value to null
  //              before it gets here. Kept so the guard cannot be narrowed on
  //              the assumption that both upstream layers still hold.
  //   negative — reachable. It survives `Number.isFinite`, and although
  //              `perMtok` now quarantines such a feed row as needs_pricing,
  //              `ai_models` carries no CHECK constraint, so any other writer
  //              can still land one. A negative rate bills a NEGATIVE cost.
  it("treats a NaN price as absent and chains to the floor", () => {
    const r = pickModel({
      active: [
        row({
          modelId: "claude-haiku-4-5",
          inputPricePerMtok: Number.NaN,
          outputPricePerMtok: 5,
        }),
      ],
      requested: "claude-haiku-4-5",
      orgDefaultModelId: null,
      tier: "cheap",
    });
    expect(r.rates).toEqual(FALLBACK_RATES["claude-haiku-4-5"]);
  });

  it("treats a negative price as absent and chains to the floor", () => {
    const r = pickModel({
      active: [
        row({
          modelId: "claude-haiku-4-5",
          inputPricePerMtok: -1,
          outputPricePerMtok: 5,
        }),
      ],
      requested: "claude-haiku-4-5",
      orgDefaultModelId: null,
      tier: "cheap",
    });
    expect(r.rates).toEqual(FALLBACK_RATES["claude-haiku-4-5"]);
  });

  it("drops an unusable cache price without discarding the usable ones", () => {
    const r = pickModel({
      active: [
        row({
          modelId: "kimi-k2-thinking",
          inputPricePerMtok: 0.6,
          outputPricePerMtok: 2.5,
          cacheReadPricePerMtok: Number.POSITIVE_INFINITY,
          cacheWritePricePerMtok: -3,
        }),
      ],
      requested: "kimi-k2-thinking",
      orgDefaultModelId: null,
      tier: "cheap",
    });
    expect(r.rates).toEqual({
      input: 0.6,
      output: 2.5,
      cacheRead: null,
      cacheWrite: null,
    });
  });

  it("never emits a non-finite rate, even for a model the floor does not know", () => {
    const r = pickModel({
      active: [
        row({
          modelId: "kimi-k2-thinking",
          inputPricePerMtok: Number.NaN,
          outputPricePerMtok: Number.NaN,
        }),
      ],
      requested: "kimi-k2-thinking",
      orgDefaultModelId: null,
      tier: "cheap",
    });
    expect(r.rates).toBeNull();
  });
});

describe("resolveModel", () => {
  const FIXTURES = [
    {
      provider: "anthropic",
      model_id: "claude-haiku-4.5",
      native_model_id: "claude-haiku-4-5-20251001",
      id_verified: true,
      status: "active",
      label: "Haiku 4.5",
      context_length: 200_000,
      max_output_tokens: 64_000,
      supports_tools: true,
      input_price_per_mtok: 1,
      output_price_per_mtok: 5,
      cache_read_price_per_mtok: null,
      cache_write_price_per_mtok: null,
      tier: "cheap",
    },
    {
      provider: "anthropic",
      model_id: "claude-sonnet-5",
      native_model_id: "claude-sonnet-5",
      id_verified: true,
      status: "active",
      label: "Sonnet 5",
      context_length: 1_000_000,
      max_output_tokens: 64_000,
      supports_tools: true,
      input_price_per_mtok: 3,
      output_price_per_mtok: 15,
      cache_read_price_per_mtok: null,
      cache_write_price_per_mtok: null,
      tier: "standard",
    },
    // Another provider's row: a dropped provider filter would let this win.
    {
      provider: "openai",
      model_id: "gpt-5-nano",
      native_model_id: "gpt-5-nano",
      id_verified: true,
      status: "active",
      label: "GPT-5 nano",
      context_length: 400_000,
      max_output_tokens: 64_000,
      supports_tools: true,
      input_price_per_mtok: 0.05,
      output_price_per_mtok: 0.4,
      cache_read_price_per_mtok: null,
      cache_write_price_per_mtok: null,
      tier: "cheap",
    },
    // ACTIVE but UNVERIFIED — the live state of mistral, google and moonshotai
    // until someone saves a key for them. The row exists, so a resolver that
    // dropped `verifiedOnly` would happily return it and send a Gateway id to
    // Mistral's own API.
    {
      provider: "mistral",
      model_id: "mistral-large-latest",
      native_model_id: null,
      id_verified: false,
      status: "active",
      label: "Mistral Large",
      context_length: 128_000,
      max_output_tokens: 32_000,
      supports_tools: true,
      input_price_per_mtok: 2,
      output_price_per_mtok: 6,
      cache_read_price_per_mtok: null,
      cache_write_price_per_mtok: null,
      tier: "standard",
    },
  ];

  it("resolves a feature's tier against the requested provider's catalog", async () => {
    const { client } = fakeAiModelsClient(FIXTURES);
    const r = await resolveModel({
      client,
      provider: "anthropic",
      feature: "item_assist",
    });
    expect(r.provider).toBe("anthropic");
    // item_assist is a cheap-tier feature, so with no pin and no org default
    // it lands on the cheap row — and never on openai's cheaper one.
    expect(r.model).toBe("claude-haiku-4.5");
    expect(r.requestModel).toBe("claude-haiku-4-5-20251001");
    expect(r.substituted).toBe(false);
  });

  it("honours the org default over the feature tier", async () => {
    const { client } = fakeAiModelsClient(FIXTURES);
    const r = await resolveModel({
      client,
      provider: "anthropic",
      feature: "item_assist",
      orgDefaultModelId: "claude-sonnet-5",
    });
    expect(r.model).toBe("claude-sonnet-5");
  });

  it("flags a substitution when a pinned model is no longer in the catalog", async () => {
    const { client } = fakeAiModelsClient(FIXTURES);
    const r = await resolveModel({
      client,
      provider: "anthropic",
      feature: "ask_pulse",
      requested: "claude-opus-4-1",
      orgDefaultModelId: "claude-sonnet-5",
    });
    expect(r.model).toBe("claude-sonnet-5");
    expect(r.substituted).toBe(true);
  });

  it("returns a null model when the provider's only active models are UNVERIFIED", async () => {
    // mistral HAS an active row in FIXTURES — it is just id_verified: false.
    // So this fails if `verifiedOnly` is ever dropped, rather than passing
    // vacuously because the provider is absent from the fixture table.
    const { client } = fakeAiModelsClient(FIXTURES);
    const r = await resolveModel({
      client,
      provider: "mistral",
      feature: "ask_pulse",
    });
    expect(r.model).toBeNull();
    expect(r.requestModel).toBeNull();
    expect(r.provider).toBe("mistral");
  });

  it("gates on id_verified, which is what keeps an unverified id off the wire", async () => {
    const { client, selects } = fakeAiModelsClient(FIXTURES);
    await resolveModel({ client, provider: "mistral", feature: "ask_pulse" });
    // Assert the predicate itself, not just its effect: the fake records every
    // .eq(), so a silently-dropped filter is visible here.
    expect(selects[0].predicates).toContainEqual({
      op: "eq",
      column: "id_verified",
      value: true,
    });
  });
});
