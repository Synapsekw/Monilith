import { describe, expect, it } from "vitest";

import {
  getModel,
  listActiveModels,
  toModelRow,
} from "@/lib/ai/models/catalog-db";
import { fakeAiModelsClient } from "@/test/ai-models-fake-client";

const MODEL_COLS =
  "provider, model_id, native_model_id, label, context_length, max_output_tokens, supports_tools, input_price_per_mtok, output_price_per_mtok, cache_read_price_per_mtok, cache_write_price_per_mtok, tier, status";

/**
 * A catalog row with every column `toModelRow` reads. Only the bits a test
 * cares about get overridden.
 */
function modelFixture(over: Record<string, unknown>) {
  return {
    provider: "anthropic",
    model_id: "claude-sonnet-5",
    native_model_id: null,
    id_verified: false,
    label: "Claude Sonnet 5",
    context_length: 200_000,
    max_output_tokens: 64_000,
    supports_tools: true,
    input_price_per_mtok: 3,
    output_price_per_mtok: 15,
    cache_read_price_per_mtok: 0.3,
    cache_write_price_per_mtok: 3.75,
    tier: "balanced",
    status: "active",
    ...over,
  };
}

/**
 * The fixture table every read test runs against. It deliberately contains
 * rows each predicate is required to exclude — an unverified row, a retired
 * row, and another provider's row — so a dropped or inverted filter changes
 * the result set rather than passing silently.
 */
function catalogFixtures() {
  return [
    modelFixture({
      model_id: "claude-sonnet-5",
      native_model_id: "claude-sonnet-5",
      id_verified: true,
      input_price_per_mtok: 3,
    }),
    modelFixture({
      model_id: "claude-haiku-4.5",
      native_model_id: null,
      id_verified: false, // quarantined: the gateway's id, unconfirmed
      input_price_per_mtok: 1,
    }),
    modelFixture({
      model_id: "claude-opus-4-8",
      native_model_id: "claude-opus-4-8",
      id_verified: true,
      status: "retired",
      input_price_per_mtok: 5,
    }),
    modelFixture({
      provider: "openai",
      model_id: "gpt-4o",
      native_model_id: "gpt-4o",
      id_verified: true,
      input_price_per_mtok: 2,
    }),
  ];
}

describe("listActiveModels · the verifiedOnly gate", () => {
  it("applies id_verified = true by default, so a quarantined row never reaches a picker", async () => {
    // This default is the single thing standing between an unverified gateway
    // id and a 404 at the provider: the catalog is populated from the Vercel
    // AI Gateway, whose id namespace is not the providers' own.
    const { client, selects } = fakeAiModelsClient(catalogFixtures());
    const rows = await listActiveModels(client, "anthropic");

    expect(selects).toHaveLength(1);
    expect(selects[0].columns).toBe(MODEL_COLS);
    expect(selects[0].predicates).toEqual([
      { op: "eq", column: "status", value: "active" },
      { op: "eq", column: "provider", value: "anthropic" },
      { op: "eq", column: "id_verified", value: true },
    ]);
    // Only the verified, active, anthropic row survives all three predicates.
    expect(rows.map((r) => r.modelId)).toEqual(["claude-sonnet-5"]);
  });

  it("omits the predicate entirely when verifiedOnly is false, surfacing the quarantine", async () => {
    const { client, selects } = fakeAiModelsClient(catalogFixtures());
    const rows = await listActiveModels(client, "anthropic", {
      verifiedOnly: false,
    });

    expect(selects[0].predicates).toEqual([
      { op: "eq", column: "status", value: "active" },
      { op: "eq", column: "provider", value: "anthropic" },
    ]);
    expect(selects[0].predicates.some((p) => p.column === "id_verified")).toBe(
      false,
    );
    // Cheapest input rate first — and the unverified row is now included.
    expect(rows.map((r) => r.modelId)).toEqual([
      "claude-haiku-4.5",
      "claude-sonnet-5",
    ]);
  });

  it("still gates when verifiedOnly is passed as true explicitly", async () => {
    const { client, selects } = fakeAiModelsClient(catalogFixtures());
    const rows = await listActiveModels(client, "anthropic", {
      verifiedOnly: true,
    });
    expect(selects[0].predicates).toContainEqual({
      op: "eq",
      column: "id_verified",
      value: true,
    });
    expect(rows.map((r) => r.modelId)).toEqual(["claude-sonnet-5"]);
  });

  it("scopes the read to one provider, never another provider's rows", async () => {
    const { client } = fakeAiModelsClient(catalogFixtures());
    const rows = await listActiveModels(client, "openai");
    expect(rows.map((r) => r.modelId)).toEqual(["gpt-4o"]);
  });

  it("maps native_model_id onto nativeModelId for the rows it returns", async () => {
    const { client } = fakeAiModelsClient(catalogFixtures());
    const rows = await listActiveModels(client, "anthropic");
    expect(rows[0].nativeModelId).toBe("claude-sonnet-5");
  });
});

describe("getModel · deliberately ungated", () => {
  it("never applies id_verified, so a caller can tell 'unverified' from 'retired'", async () => {
    const { client, selects } = fakeAiModelsClient(catalogFixtures());
    const row = await getModel(client, "anthropic", "claude-haiku-4.5");

    expect(selects).toHaveLength(1);
    expect(selects[0].single).toBe(true);
    expect(selects[0].predicates).toEqual([
      { op: "eq", column: "provider", value: "anthropic" },
      { op: "eq", column: "model_id", value: "claude-haiku-4.5" },
    ]);
    expect(row?.modelId).toBe("claude-haiku-4.5");
    expect(row?.nativeModelId).toBeNull();
  });

  it("returns a retired row too, rather than collapsing it to 'not found'", async () => {
    const { client } = fakeAiModelsClient(catalogFixtures());
    const row = await getModel(client, "anthropic", "claude-opus-4-8");
    expect(row?.status).toBe("retired");
  });

  it("returns null for a model this provider does not carry", async () => {
    const { client } = fakeAiModelsClient(catalogFixtures());
    // gpt-4o exists, but on openai — the composite key must not collapse.
    expect(await getModel(client, "anthropic", "gpt-4o")).toBeNull();
  });
});

describe("toModelRow", () => {
  it("maps native_model_id to nativeModelId", () => {
    const row = toModelRow(
      modelFixture({
        model_id: "claude-haiku-4.5",
        native_model_id: "claude-haiku-4-5",
      }) as never,
    );
    // The gateway id stays the catalog key; the native id is what an adapter
    // must actually send (`nativeModelId ?? modelId`).
    expect(row.modelId).toBe("claude-haiku-4.5");
    expect(row.nativeModelId).toBe("claude-haiku-4-5");
  });

  it("keeps nativeModelId null for an unverified row rather than defaulting to modelId", () => {
    // Defaulting here would silently undo the quarantine: callers would send
    // the gateway's id to the provider believing it had been confirmed.
    const row = toModelRow(
      modelFixture({
        model_id: "claude-haiku-4.5",
        native_model_id: null,
      }) as never,
    );
    expect(row.nativeModelId).toBeNull();
  });

  it("coerces PostgREST's numeric-as-string prices back to numbers", () => {
    const row = toModelRow(
      modelFixture({
        input_price_per_mtok: "3.00",
        output_price_per_mtok: null,
      }) as never,
    );
    expect(row.inputPricePerMtok).toBe(3);
    expect(row.outputPricePerMtok).toBeNull();
  });
});
