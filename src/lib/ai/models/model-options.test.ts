import { describe, it, expect } from "vitest";
import type { ProviderRow } from "@/lib/ai/providers/provider-rows";
import { buildModelOptions } from "./model-options";

/**
 * The fake catalog client APPLIES its predicates rather than recording them and
 * returning everything. `buildModelOptions` goes through `listActiveModels`,
 * whose whole job is three filters (`status`, `provider`, `id_verified`) and an
 * ordering — a fake that ignored them would let a picker built from retired or
 * unverified rows pass green, which is the exact failure this suite exists to
 * catch.
 */
type Row = Record<string, unknown>;

function fakeCatalog(rows: Row[]) {
  const eqCalls: [string, unknown][] = [];

  function builder(current: Row[]) {
    return {
      eq(col: string, val: unknown) {
        eqCalls.push([col, val]);
        return builder(current.filter((r) => r[col] === val));
      },
      order(col: string, opts: { ascending: boolean; nullsFirst: boolean }) {
        const sorted = [...current].sort((a, b) => {
          const av = a[col] as number | null;
          const bv = b[col] as number | null;
          if (av === null && bv === null) return 0;
          if (av === null) return opts.nullsFirst ? -1 : 1;
          if (bv === null) return opts.nullsFirst ? 1 : -1;
          return opts.ascending ? av - bv : bv - av;
        });
        return Promise.resolve({ data: sorted, error: null });
      },
    };
  }

  const client = {
    from: (table: string) => ({
      select: () => builder(table === "ai_models" ? rows : []),
    }),
  };
  return { client: client as never, eqCalls };
}

function modelRow(over: Row = {}): Row {
  return {
    provider: "anthropic",
    model_id: "claude-haiku-4.5",
    // DIFFERENT from model_id on purpose: the Gateway's namespace is not
    // Anthropic's, and this is the value that must never reach a picker.
    native_model_id: "claude-haiku-4-5-20251001",
    label: "Claude Haiku 4.5",
    context_length: 200000,
    max_output_tokens: 8192,
    supports_tools: true,
    input_price_per_mtok: 1,
    output_price_per_mtok: 5,
    cache_read_price_per_mtok: null,
    cache_write_price_per_mtok: null,
    tier: "cheap",
    status: "active",
    id_verified: true,
    ...over,
  };
}

const PROVIDERS: ProviderRow[] = [
  {
    id: "anthropic",
    label: "Anthropic (Claude)",
    adapterKind: "anthropic",
    baseUrl: null,
    keyPlaceholder: "sk-ant-…",
    keyFormat: "^sk-ant-",
    enabled: true,
  },
  {
    id: "moonshotai",
    label: "Kimi (Moonshot AI)",
    adapterKind: "openai-compatible",
    baseUrl: "https://api.moonshot.ai/v1",
    keyPlaceholder: "sk-…",
    keyFormat: "^sk-",
    enabled: true,
  },
];

describe("buildModelOptions", () => {
  it("offers the CATALOG key, never the provider's wire id", async () => {
    // The one assertion that would fail if an option ever carried
    // `native_model_id`: a pin storing the wire id resolves to nothing, and the
    // usage ledger — which records the catalog key — would disagree with it.
    const { client } = fakeCatalog([modelRow()]);
    const options = await buildModelOptions(client, [PROVIDERS[0]]);
    expect(options).toEqual([
      {
        provider: "anthropic",
        providerLabel: "Anthropic (Claude)",
        modelId: "claude-haiku-4.5",
        label: "Claude Haiku 4.5",
        tier: "cheap",
        supportsTools: true,
        contextLength: 200000,
      },
    ]);
    expect(JSON.stringify(options)).not.toContain("claude-haiku-4-5-20251001");
  });

  // The reference-document budget meter (`DocumentPicker`) reads this straight
  // off the selected `ModelOption` to compute the same budget the run loop
  // will — a null here is what makes it disclose the assumed-context copy
  // instead of asserting a window the catalog never confirmed.
  it("carries context_length through, including when the catalog has not backfilled it", async () => {
    const { client } = fakeCatalog([modelRow({ context_length: null })]);
    const options = await buildModelOptions(client, [PROVIDERS[0]]);
    expect(options[0]?.contextLength).toBeNull();
  });

  it("leaves out retired models", async () => {
    const { client } = fakeCatalog([
      modelRow(),
      modelRow({ model_id: "claude-3-old", status: "retired" }),
    ]);
    const options = await buildModelOptions(client, [PROVIDERS[0]]);
    expect(options.map((o) => o.modelId)).toEqual(["claude-haiku-4.5"]);
  });

  // A provider's catalog ids are only confirmed against that provider's own
  // model list. Offering an unverified id is offering a 404.
  it("leaves out ids that were never verified against the provider", async () => {
    const { client } = fakeCatalog([
      modelRow(),
      modelRow({ model_id: "claude-guessed-9", id_verified: false }),
    ]);
    const options = await buildModelOptions(client, [PROVIDERS[0]]);
    expect(options.map((o) => o.modelId)).toEqual(["claude-haiku-4.5"]);
  });

  it("labels every option from the provider row, not from a hardcoded map", async () => {
    const { client } = fakeCatalog([
      modelRow(),
      modelRow({
        provider: "moonshotai",
        model_id: "kimi-k2",
        native_model_id: null,
        label: "Kimi K2 Instruct",
        input_price_per_mtok: 0.6,
      }),
    ]);
    const options = await buildModelOptions(client, PROVIDERS);
    expect(
      options.map((o) => [o.provider, o.providerLabel, o.modelId]),
    ).toEqual([
      ["anthropic", "Anthropic (Claude)", "claude-haiku-4.5"],
      ["moonshotai", "Kimi (Moonshot AI)", "kimi-k2"],
    ]);
  });

  // The picker renders the flat list in order without re-sorting, so the order
  // this returns IS the order a user reads.
  it("keeps providers in the order given and models cheapest-first within one", async () => {
    const { client } = fakeCatalog([
      modelRow({ model_id: "claude-opus-5", input_price_per_mtok: 15 }),
      modelRow({ model_id: "claude-haiku-4.5", input_price_per_mtok: 1 }),
      modelRow({
        provider: "moonshotai",
        model_id: "kimi-k2",
        input_price_per_mtok: 0.6,
      }),
    ]);
    const options = await buildModelOptions(client, PROVIDERS);
    expect(options.map((o) => o.modelId)).toEqual([
      "claude-haiku-4.5",
      "claude-opus-5",
      "kimi-k2",
    ]);
  });

  it("returns an empty list for a provider with nothing selectable", async () => {
    const { client } = fakeCatalog([]);
    await expect(buildModelOptions(client, PROVIDERS)).resolves.toEqual([]);
  });

  it("reads nothing when no provider is enabled", async () => {
    const { client, eqCalls } = fakeCatalog([modelRow()]);
    await expect(buildModelOptions(client, [])).resolves.toEqual([]);
    expect(eqCalls).toEqual([]);
  });
});
