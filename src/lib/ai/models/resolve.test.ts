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

const CATALOG = [
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
    expect(r.rates).toEqual({
      input: 1,
      output: 15,
      cacheRead: null,
      cacheWrite: null,
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
        }),
      ],
      requested: "claude-sonnet-5",
      orgDefaultModelId: null,
      tier: "standard",
    });
    expect(r.rates).toEqual({
      input: 3,
      output: 15,
      cacheRead: null,
      cacheWrite: null,
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
  // A NaN or negative rate produces a NaN cost, which serializes to null at
  // the record_ai_usage boundary — spend that vanishes instead of failing.
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

  it("returns a null model when the provider has no verified active models", async () => {
    const { client } = fakeAiModelsClient(FIXTURES);
    const r = await resolveModel({
      client,
      provider: "mistral",
      feature: "ask_pulse",
    });
    expect(r.model).toBeNull();
    expect(r.provider).toBe("mistral");
  });
});
