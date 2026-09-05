import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fakeAiModelsClient,
  type AiModelFixture,
} from "@/test/ai-models-fake-client";

const ORG_ID = "org-1";
const USER_ID = "user-42";

const rpc = vi.fn();
const maybeSingle = vi.fn();

/**
 * Provider registry fixture. Keyed by id, shaped like an `ai_providers` row —
 * the gateway narrows it through `toProviderRow`, so a wrong `adapter_kind`
 * here would throw exactly as it would in production.
 */
type FakeProviderRow = {
  id: string;
  label: string;
  adapter_kind: string;
  base_url: string | null;
  key_placeholder: string;
  key_format: string;
  enabled: boolean;
};

function providerRow(
  id: string,
  adapterKind: string,
  baseUrl: string | null,
  enabled = true,
): FakeProviderRow {
  return {
    id,
    label: id,
    adapter_kind: adapterKind,
    base_url: baseUrl,
    key_placeholder: "sk-…",
    key_format: "^sk-",
    enabled,
  };
}

let providers: Record<string, FakeProviderRow> = {};
let models = fakeAiModelsClient([]);

/** An `ai_models` row with sane defaults; override only what a test asserts on. */
function modelFixture(
  o: { provider: string; model_id: string } & Partial<AiModelFixture>,
): AiModelFixture {
  return {
    native_model_id: null,
    label: o.model_id,
    context_length: 200_000,
    max_output_tokens: 8192,
    supports_tools: true,
    input_price_per_mtok: 1,
    output_price_per_mtok: 5,
    cache_read_price_per_mtok: null,
    cache_write_price_per_mtok: null,
    tier: "standard",
    status: "active",
    id_verified: true,
    ...o,
  };
}

function setModels(fixtures: AiModelFixture[]) {
  models = fakeAiModelsClient(fixtures);
}

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    rpc,
    from: (table: string) => {
      // `ai_models` goes through the shared argument-aware fake, so a dropped
      // provider/status/id_verified predicate changes the rows a test sees.
      if (table === "ai_models") return models.client.from("ai_models");
      if (table === "ai_providers")
        return {
          select: () => ({
            eq: (_column: string, id: string) => ({
              maybeSingle: () =>
                Promise.resolve({ data: providers[id] ?? null, error: null }),
            }),
          }),
        };
      // org_ai_settings.
      return { select: () => ({ eq: () => ({ maybeSingle }) }) };
    },
  }),
}));

const resolveUserAdapterById = vi.fn();
vi.mock("@/lib/ai/credentials", () => ({
  resolveUserAdapterById: (...a: unknown[]) => resolveUserAdapterById(...a),
  asTrustedUserId: (id: string) => id,
}));

vi.mock("@/lib/env.server", () => ({
  getServerEnv: () => ({ ANTHROPIC_API_KEY: process.env.TEST_MANAGED_KEY }),
}));

// Adapters are keyed by WIRE FORMAT now; the provider id is carried on the
// resolved object rather than read back off the adapter.
const anthropicAdapter = { kind: "anthropic" };
const googleAdapter = { kind: "google" };
const compatibleAdapter = { kind: "openai-compatible" };
vi.mock("@/lib/ai/providers/registry", () => ({
  getAdapter: (k: string) =>
    k === "google"
      ? googleAdapter
      : k === "openai-compatible"
        ? compatibleAdapter
        : anthropicAdapter,
}));

function settingsRow(mode: string, extra: Record<string, unknown> = {}) {
  maybeSingle.mockResolvedValue({
    data: {
      ai_mode: mode,
      tier: "none",
      monthly_credit_limit: 0,
      byo_provider: null,
      byo_key_last4: null,
      default_provider: null,
      default_model_id: null,
      max_agents_per_user: 3,
      max_agent_runs_per_user_per_day: 3,
      ...extra,
    },
    error: null,
  });
}

/** The per_user credential resolver, driven by the same provider fixtures. */
function userKeys(byProvider: Record<string, string>) {
  resolveUserAdapterById.mockImplementation(
    async (_userId: string, provider: string) => {
      const { PersonalAiKeyMissingError } = await import("@/lib/ai/errors");
      const row = providers[provider];
      const key = byProvider[provider];
      if (!row || !row.enabled || !key)
        throw new PersonalAiKeyMissingError(provider);
      return {
        adapter:
          row.adapter_kind === "openai-compatible"
            ? compatibleAdapter
            : anthropicAdapter,
        apiKey: key,
        baseUrl: row.base_url,
      };
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.TEST_MANAGED_KEY;
  providers = {
    anthropic: providerRow("anthropic", "anthropic", null),
    google: providerRow("google", "google", null),
    mistral: providerRow(
      "mistral",
      "openai-compatible",
      "https://api.mistral.ai/v1",
    ),
    moonshotai: providerRow(
      "moonshotai",
      "openai-compatible",
      "https://api.moonshot.ai/v1",
    ),
  };
  setModels([
    modelFixture({
      provider: "anthropic",
      model_id: "claude-sonnet-5",
      native_model_id: "claude-sonnet-5-20260101",
      // The Gateway publishes Anthropic's INTRODUCTORY rate; FALLBACK_RATES
      // floors it back to the standard $3/$15 (see pricing.ts).
      input_price_per_mtok: 2,
      output_price_per_mtok: 10,
    }),
    modelFixture({
      provider: "anthropic",
      model_id: "claude-haiku-4.5",
      native_model_id: "claude-haiku-4-5",
      tier: "cheap",
      input_price_per_mtok: 0.5,
      output_price_per_mtok: 2,
    }),
    modelFixture({
      provider: "moonshotai",
      model_id: "kimi-k2",
      input_price_per_mtok: 0.6,
      output_price_per_mtok: 2.5,
    }),
  ]);
});

describe("resolveAiAdapter — 4-mode matrix", () => {
  it("off → AiDisabledError", async () => {
    settingsRow("off");
    const { resolveAiAdapter } = await import("@/lib/ai/gateway");
    await expect(resolveAiAdapter(ORG_ID, USER_ID)).rejects.toMatchObject({
      name: "AiDisabledError",
    });
  });

  it("missing row → AiDisabledError (an org with no settings has not bought AI)", async () => {
    // Until 2026-08-02 a missing row meant `per_user` — a brand-new org got a
    // working AI surface for free. Under managed-only billing the fallback is
    // `off`. Every org predating the change received an explicit `per_user` row
    // from 20260802133040_org_ai_settings_backfill, so this path is reached only
    // by genuinely new orgs.
    maybeSingle.mockResolvedValue({ data: null, error: null });
    const { resolveAiAdapter } = await import("@/lib/ai/gateway");
    await expect(resolveAiAdapter(ORG_ID, USER_ID)).rejects.toMatchObject({
      name: "AiDisabledError",
    });
  });

  it("managed → anthropic adapter + env key; missing env key → AiNotConfiguredError", async () => {
    settingsRow("managed");
    const { resolveAiAdapter } = await import("@/lib/ai/gateway");
    await expect(resolveAiAdapter(ORG_ID, USER_ID)).rejects.toMatchObject({
      name: "AiNotConfiguredError",
    });
    process.env.TEST_MANAGED_KEY = "sk-ant-managed";
    const r = await resolveAiAdapter(ORG_ID, USER_ID);
    expect(r).toMatchObject({
      mode: "managed",
      provider: "anthropic",
      apiKey: "sk-ant-managed",
      baseUrl: null,
    });
  });

  it("managed cannot serve a non-Anthropic request — the platform key is Anthropic's", async () => {
    settingsRow("managed");
    process.env.TEST_MANAGED_KEY = "sk-ant-managed";
    const { resolveAiAdapter } = await import("@/lib/ai/gateway");
    await expect(
      resolveAiAdapter(ORG_ID, USER_ID, "mistral"),
    ).rejects.toMatchObject({
      name: "ByoKeyMissingError",
      provider: "mistral",
    });
  });

  it("org_byo → org vault secret via rpc, asked for BY PROVIDER; no secret → ByoKeyMissingError", async () => {
    settingsRow("org_byo", { byo_provider: "google" });
    rpc.mockResolvedValueOnce({
      data: [{ provider: "google", secret: "g-key" }],
      error: null,
    });
    const { resolveAiAdapter } = await import("@/lib/ai/gateway");
    const r = await resolveAiAdapter(ORG_ID, USER_ID);
    expect(rpc).toHaveBeenCalledWith("org_ai_secret_get", {
      p_org: ORG_ID,
      p_provider: "google",
    });
    expect(r).toMatchObject({
      mode: "org_byo",
      provider: "google",
      apiKey: "g-key",
    });

    rpc.mockResolvedValueOnce({ data: [], error: null });
    await expect(resolveAiAdapter(ORG_ID, USER_ID)).rejects.toMatchObject({
      name: "ByoKeyMissingError",
      provider: "google",
    });
  });

  it("org_byo → an openai-compatible provider carries its base_url", async () => {
    settingsRow("org_byo", { byo_provider: "mistral" });
    rpc.mockResolvedValue({
      data: [{ provider: "mistral", secret: "sk-mistral" }],
      error: null,
    });
    const { resolveAiAdapter } = await import("@/lib/ai/gateway");
    const r = await resolveAiAdapter(ORG_ID, USER_ID);
    expect(r).toMatchObject({
      provider: "mistral",
      apiKey: "sk-mistral",
      baseUrl: "https://api.mistral.ai/v1",
      adapter: compatibleAdapter,
    });
  });

  it("org_byo → vault rpc error propagates raw (not ByoKeyMissingError)", async () => {
    settingsRow("org_byo", { byo_provider: "google" });
    rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "vault down" },
    });
    const { resolveAiAdapter } = await import("@/lib/ai/gateway");
    let caught: unknown;
    try {
      await resolveAiAdapter(ORG_ID, USER_ID);
    } catch (e) {
      caught = e;
    }
    expect(caught).toMatchObject({ message: "vault down" });
    expect((caught as { name?: string })?.name).not.toBe("ByoKeyMissingError");
  });

  it("a DISABLED provider is refused before any catalog read", async () => {
    // listActiveModels filters status/provider/id_verified but does NOT join
    // ai_providers.enabled, so this is the only gate that stops a retired
    // provider's models resolving. runAi reaches the catalog exclusively
    // through here.
    settingsRow("org_byo", { byo_provider: "mistral" });
    providers.mistral = providerRow(
      "mistral",
      "openai-compatible",
      "https://api.mistral.ai/v1",
      false,
    );
    rpc.mockResolvedValue({
      data: [{ provider: "mistral", secret: "sk-mistral" }],
      error: null,
    });
    const { resolveAiAdapter } = await import("@/lib/ai/gateway");
    await expect(resolveAiAdapter(ORG_ID, USER_ID)).rejects.toMatchObject({
      name: "ByoKeyMissingError",
      provider: "mistral",
    });
  });

  it("per_user → resolveUserAdapterById passthrough, keyed on the SUPPLIED userId", async () => {
    settingsRow("per_user");
    userKeys({ anthropic: "sk-user" });
    const { resolveAiAdapter } = await import("@/lib/ai/gateway");
    const r = await resolveAiAdapter(ORG_ID, USER_ID);
    expect(r).toMatchObject({
      mode: "per_user",
      apiKey: "sk-user",
      // Reported by the credential resolver, not inferred from the adapter —
      // one adapter can serve several providers.
      provider: "anthropic",
    });
    // The whole point of the fix: resolution is keyed on the caller-supplied
    // userId, not a session — never a different id than what runAi meters
    // against.
    expect(resolveUserAdapterById).toHaveBeenCalledWith(USER_ID, "anthropic");
  });

  it("resolves the REQUESTED provider's key, not whichever key exists", async () => {
    // An agent pinned to Kimi must spend the Kimi key. Resolving 'whatever key
    // the user has' would send an Anthropic key to Moonshot's endpoint.
    settingsRow("per_user");
    userKeys({ anthropic: "sk-user", moonshotai: "sk-kimi" });
    const { resolveAiAdapter } = await import("@/lib/ai/gateway");
    const resolved = await resolveAiAdapter(ORG_ID, USER_ID, "moonshotai");
    expect(resolved.provider).toBe("moonshotai");
    expect(resolved.baseUrl).toBe("https://api.moonshot.ai/v1");
    expect(resolved.apiKey).toBe("sk-kimi");
  });

  it("per_user takes the ORG DEFAULT provider when the caller names none", async () => {
    // This is the configuration that makes the tool-loop capability guard
    // load-bearing: before the provider was threaded, per_user was hardcoded
    // to "anthropic", so an org default could never reach a loop that builds
    // `new Anthropic()` directly. Now it can — hence assertToolLoopCapable at
    // the top of every such callback.
    settingsRow("per_user", { default_provider: "moonshotai" });
    userKeys({ anthropic: "sk-user", moonshotai: "sk-kimi" });
    const { resolveAiAdapter } = await import("@/lib/ai/gateway");
    const r = await resolveAiAdapter(ORG_ID, USER_ID);
    expect(r).toMatchObject({
      provider: "moonshotai",
      apiKey: "sk-kimi",
      baseUrl: "https://api.moonshot.ai/v1",
    });
    expect(resolveUserAdapterById).toHaveBeenCalledWith(USER_ID, "moonshotai");
  });

  it("an explicit provider still beats the org default", async () => {
    settingsRow("per_user", { default_provider: "moonshotai" });
    userKeys({ anthropic: "sk-user", moonshotai: "sk-kimi" });
    const { resolveAiAdapter } = await import("@/lib/ai/gateway");
    const r = await resolveAiAdapter(ORG_ID, USER_ID, "anthropic");
    expect(r).toMatchObject({ provider: "anthropic", apiKey: "sk-user" });
  });

  it("names the provider when its key is missing", async () => {
    settingsRow("per_user");
    userKeys({ anthropic: "sk-user" });
    const { resolveAiAdapter } = await import("@/lib/ai/gateway");
    await expect(
      resolveAiAdapter(ORG_ID, USER_ID, "mistral"),
    ).rejects.toMatchObject({ provider: "mistral" });
  });

  it("per_user with no key on file → PersonalAiKeyMissingError (a per-user config state runAi callers can catch, not a raw crash)", async () => {
    settingsRow("per_user");
    userKeys({});
    const { AiNotConfiguredError, PersonalAiKeyMissingError } =
      await import("@/lib/ai/errors");
    const { resolveAiAdapter } = await import("@/lib/ai/gateway");
    await expect(resolveAiAdapter(ORG_ID, USER_ID)).rejects.toBeInstanceOf(
      PersonalAiKeyMissingError,
    );
    // Still catchable by every existing `instanceof AiNotConfiguredError`
    // check (mapAiError, interactive action call sites) — this is a strict
    // narrowing, not a breaking change to that contract.
    await expect(
      resolveAiAdapter(ORG_ID, USER_ID).catch((e) => e),
    ).resolves.toBeInstanceOf(AiNotConfiguredError);
  });

  it("managed with a missing platform key stays a plain AiNotConfiguredError, NOT the narrower per-user subtype", async () => {
    settingsRow("managed");
    const { AiNotConfiguredError, PersonalAiKeyMissingError } =
      await import("@/lib/ai/errors");
    const { resolveAiAdapter } = await import("@/lib/ai/gateway");
    const err = await resolveAiAdapter(ORG_ID, USER_ID).catch((e) => e);
    expect(err).toBeInstanceOf(AiNotConfiguredError);
    expect(err).not.toBeInstanceOf(PersonalAiKeyMissingError);
  });
});

describe("runAi", () => {
  beforeEach(() => {
    settingsRow("per_user");
    userKeys({ anthropic: "sk-user", moonshotai: "sk-kimi" });
    rpc.mockResolvedValue({ data: null, error: null });
  });

  it("invokes fn with the resolved adapter and records a ledger row", async () => {
    const { runAi } = await import("@/lib/ai/gateway");

    const out = await runAi(
      { orgId: ORG_ID, userId: "u-1", feature: "dashboard_gen" },
      async () => ({
        result: "ok",
        usage: { inputTokens: 2000, outputTokens: 500 },
      }),
    );

    expect(out).toBe("ok");
    expect(rpc).toHaveBeenCalledWith(
      "record_ai_usage",
      expect.objectContaining({
        p_org: ORG_ID,
        p_user: "u-1",
        p_feature: "dashboard_gen",
        p_provider: "anthropic",
        // The CATALOG KEY, not the wire id: this is what a pin, a picker and
        // the ledger all speak.
        p_model: "claude-sonnet-5",
        p_input_tokens: 2000,
        p_output_tokens: 500,
        // Floored to the standard $3/$15 even though the catalog row publishes
        // the introductory $2/$10.
        p_cost_usd: 0.0135,
        p_credits: 1.35,
      }),
    );
    // Credential resolution and ledger attribution must agree by
    // construction: the same "u-1" that gets billed is the id whose key ran.
    expect(resolveUserAdapterById).toHaveBeenCalledWith("u-1", "anthropic");
  });

  it("hands the callback the WIRE id, never the catalog key", async () => {
    // The Gateway's namespace is not Anthropic's: sending `claude-haiku-4.5`
    // to Anthropic is a 404. `requestModel` is the only field an adapter may
    // receive.
    const { runAi } = await import("@/lib/ai/gateway");
    const seen: string[] = [];
    await runAi(
      { orgId: ORG_ID, userId: USER_ID, feature: "item_assist" },
      async ({ model }) => {
        seen.push(model.requestModel ?? "<null>", model.model ?? "<null>");
        return { result: 1, usage: { inputTokens: 0, outputTokens: 0 } };
      },
    );
    expect(seen).toEqual(["claude-haiku-4-5", "claude-haiku-4.5"]);
  });

  it("routes the feature's TIER through the catalog (cheap → the cheap row)", async () => {
    const { runAi } = await import("@/lib/ai/gateway");
    await runAi(
      { orgId: ORG_ID, userId: USER_ID, feature: "item_assist" },
      async () => ({
        result: 1,
        usage: { inputTokens: 1_000_000, outputTokens: 0 },
      }),
    );
    expect(rpc).toHaveBeenCalledWith(
      "record_ai_usage",
      // The FLOOR reaching a model whose Gateway id is spelled with a DOT: the
      // catalog publishes $0.50/Mtok, FALLBACK_RATES["claude-haiku-4-5"] holds
      // $1, and the lookup finds it through the native id. Until the key
      // normalisation this billed $0.50 — the floor missed every dotted id.
      expect.objectContaining({ p_model: "claude-haiku-4.5", p_cost_usd: 1 }),
    );
  });

  it("an explicit tier overrides the feature's own tier", async () => {
    // column_fill's long-context fallback: above Haiku's row limit the call has
    // to move up a tier, and the ledger must follow it.
    const { runAi } = await import("@/lib/ai/gateway");
    await runAi(
      {
        orgId: ORG_ID,
        userId: USER_ID,
        feature: "column_fill",
        tier: "standard",
      },
      async () => ({ result: 1, usage: { inputTokens: 0, outputTokens: 0 } }),
    );
    expect(rpc).toHaveBeenCalledWith(
      "record_ai_usage",
      expect.objectContaining({ p_model: "claude-sonnet-5" }),
    );
  });

  it("spends the REQUESTED provider's key and meters its own catalog row", async () => {
    const { runAi } = await import("@/lib/ai/gateway");
    const seen: string[] = [];
    await runAi(
      {
        orgId: ORG_ID,
        userId: USER_ID,
        feature: "ask_pulse",
        provider: "moonshotai",
      },
      async ({ provider, baseUrl, model }) => {
        seen.push(provider, baseUrl ?? "<null>", model.requestModel ?? "");
        return {
          result: 1,
          usage: { inputTokens: 1_000_000, outputTokens: 0 },
        };
      },
    );
    expect(seen).toEqual([
      "moonshotai",
      "https://api.moonshot.ai/v1",
      "kimi-k2",
    ]);
    expect(rpc).toHaveBeenCalledWith(
      "record_ai_usage",
      expect.objectContaining({
        p_provider: "moonshotai",
        p_model: "kimi-k2",
        // Kimi is in no fallback table, so the catalog price is billed as-is.
        p_cost_usd: 0.6,
      }),
    );
  });

  it("refuses to run — and bills nothing — when the provider has no usable model", async () => {
    // computeCostUsd(null, usage) is $0: a provider with an empty catalog would
    // otherwise buy free inference. Google's rows are all unverified until a
    // key is saved, so this is the live state of three of the five providers.
    setModels([
      modelFixture({
        provider: "google",
        model_id: "gemini-3-pro",
        id_verified: false,
      }),
    ]);
    settingsRow("org_byo", { byo_provider: "google" });
    rpc.mockResolvedValue({
      data: [{ provider: "google", secret: "g-key" }],
      error: null,
    });
    const { runAi } = await import("@/lib/ai/gateway");
    const fn = vi.fn();
    await expect(
      runAi({ orgId: ORG_ID, userId: USER_ID, feature: "ask_pulse" }, fn),
    ).rejects.toMatchObject({
      name: "NoUsableModelError",
      provider: "google",
    });
    expect(fn).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalledWith("record_ai_usage", expect.anything());
  });

  it("refuses an UNPRICED model as firmly as a missing one", async () => {
    // The other half of the same guard. computeCostUsd(null, usage) is $0, so
    // an active, id_verified row whose price columns are null would run and
    // meter free inference for any provider outside FALLBACK_RATES. The feed
    // quarantines unpriced rows (feed-parse.ts), so this is not reachable
    // THROUGH the feed — but resolve.ts's usablePrice names "a manual fix, a
    // future importer" as its threat model, and this is the leg that was open.
    setModels([
      modelFixture({
        provider: "moonshotai",
        model_id: "kimi-k2",
        input_price_per_mtok: null,
        output_price_per_mtok: null,
      }),
    ]);
    const { runAi } = await import("@/lib/ai/gateway");
    const fn = vi.fn();
    await expect(
      runAi(
        {
          orgId: ORG_ID,
          userId: USER_ID,
          feature: "ask_pulse",
          provider: "moonshotai",
        },
        fn,
      ),
    ).rejects.toMatchObject({
      name: "NoUsableModelError",
      provider: "moonshotai",
    });
    expect(fn).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalledWith("record_ai_usage", expect.anything());
  });

  it("prefers the org's default model — but only for the org's own provider", async () => {
    settingsRow("per_user", {
      default_provider: "anthropic",
      default_model_id: "claude-haiku-4.5",
    });
    const { runAi } = await import("@/lib/ai/gateway");
    await runAi(
      { orgId: ORG_ID, userId: USER_ID, feature: "ask_pulse" },
      async () => ({ result: 1, usage: { inputTokens: 0, outputTokens: 0 } }),
    );
    expect(rpc).toHaveBeenCalledWith(
      "record_ai_usage",
      expect.objectContaining({ p_model: "claude-haiku-4.5" }),
    );

    // Same default, a different provider requested: the org default names an
    // ANTHROPIC catalog key, which is meaningless to Moonshot.
    rpc.mockClear();
    rpc.mockResolvedValue({ data: null, error: null });
    await runAi(
      {
        orgId: ORG_ID,
        userId: USER_ID,
        feature: "ask_pulse",
        provider: "moonshotai",
      },
      async () => ({ result: 1, usage: { inputTokens: 0, outputTokens: 0 } }),
    );
    expect(rpc).toHaveBeenCalledWith(
      "record_ai_usage",
      expect.objectContaining({ p_model: "kimi-k2" }),
    );
  });

  it("honours an explicit model pin and reports a substitution when it is gone", async () => {
    const { runAi } = await import("@/lib/ai/gateway");
    const substituted: boolean[] = [];
    await runAi(
      {
        orgId: ORG_ID,
        userId: USER_ID,
        feature: "ask_pulse",
        requestedModel: "claude-haiku-4.5",
      },
      async ({ model }) => {
        substituted.push(model.substituted);
        return { result: 1, usage: { inputTokens: 0, outputTokens: 0 } };
      },
    );
    await runAi(
      {
        orgId: ORG_ID,
        userId: USER_ID,
        feature: "ask_pulse",
        requestedModel: "claude-retired-9",
      },
      async ({ model }) => {
        substituted.push(model.substituted);
        return { result: 1, usage: { inputTokens: 0, outputTokens: 0 } };
      },
    );
    expect(substituted).toEqual([false, true]);
  });

  it("a failed ledger write does not fail the call", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "ledger down" } });
    const { runAi } = await import("@/lib/ai/gateway");
    await expect(
      runAi({ orgId: ORG_ID, userId: "u", feature: "ask_pulse" }, async () => ({
        result: 1,
        usage: { inputTokens: 0, outputTokens: 0 },
      })),
    ).resolves.toBe(1);
  });

  it("passes runId through to record_ai_usage as p_run_id", async () => {
    // The correlation that makes a DELEGATED child's spend attributable at
    // all. Without it every personal-agent call in an org collapses into one
    // `personal_agent_run` bucket, and the run-history subtree total (Task 7)
    // has nothing to sum. A nested run passes its OWN id, never its parent's.
    const { runAi } = await import("@/lib/ai/gateway");
    const RUN_ID = "11111111-2222-4333-8444-555555555555";

    await runAi(
      {
        orgId: ORG_ID,
        userId: "user-1",
        feature: "personal_agent_run",
        runId: RUN_ID,
      },
      async () => ({
        result: "ok",
        usage: { inputTokens: 10, outputTokens: 5 },
      }),
    );

    expect(rpc).toHaveBeenCalledWith(
      "record_ai_usage",
      expect.objectContaining({ p_run_id: RUN_ID }),
    );
  });

  it("sends p_run_id as null when the call belongs to no run", async () => {
    // Explicit null, not an omitted key: `record_ai_usage` defaults the
    // parameter, but every other optional argument in this call is written
    // out, and an omitted key is indistinguishable from a key we forgot to
    // thread through when reading a failing ledger row.
    const { runAi } = await import("@/lib/ai/gateway");

    await runAi(
      { orgId: ORG_ID, userId: "user-1", feature: "ask_pulse" },
      async () => ({
        result: "ok",
        usage: { inputTokens: 10, outputTokens: 5 },
      }),
    );

    expect(rpc).toHaveBeenCalledWith(
      "record_ai_usage",
      expect.objectContaining({ p_run_id: null }),
    );
  });

  it("passes cache token counts through to record_ai_usage", async () => {
    const { runAi } = await import("@/lib/ai/gateway");

    await runAi(
      { orgId: ORG_ID, userId: "user-1", feature: "ask_pulse" },
      async () => ({
        result: "ok",
        usage: {
          inputTokens: 1000,
          outputTokens: 500,
          cacheReadTokens: 20_000,
          cacheWriteTokens: 4_000,
        },
      }),
    );

    expect(rpc).toHaveBeenCalledWith(
      "record_ai_usage",
      expect.objectContaining({
        p_model: "claude-sonnet-5",
        p_input_tokens: 1000,
        p_output_tokens: 500,
        p_cache_read_tokens: 20_000,
        p_cache_write_tokens: 4_000,
        // The FLOOR reaching the wire: $3/$15 with derived cache rates, not the
        // catalog's introductory $2/$10.
        p_cost_usd: 0.0315,
        p_credits: 3.15,
      }),
    );
  });

  // A callback that spends tokens and THEN throws — the agent tool loop, where
  // steps 1–11 are real billed round-trips and a step-12 provider 5xx rejects
  // the whole call. Metering only on resolution spends managed-mode money
  // against no ledger row and under-counts the monthly credit ceiling.
  it("meters what a throwing callback reported it had already spent", async () => {
    const { runAi } = await import("@/lib/ai/gateway");

    await expect(
      runAi(
        { orgId: ORG_ID, userId: "user-1", feature: "personal_agent_run" },
        async (_resolved, reportUsage) => {
          reportUsage({ inputTokens: 100, outputTokens: 50 });
          reportUsage({
            inputTokens: 1000,
            outputTokens: 500,
            cacheReadTokens: 20_000,
            cacheWriteTokens: 4_000,
          });
          throw new Error("provider 503");
        },
      ),
    ).rejects.toThrow("provider 503");

    // The LAST report wins — a running total, not a delta to accumulate.
    const ledgerWrites = rpc.mock.calls.filter(
      (c) => c[0] === "record_ai_usage",
    );
    expect(ledgerWrites).toHaveLength(1);
    expect(ledgerWrites[0]?.[1]).toMatchObject({
      p_feature: "personal_agent_run",
      p_input_tokens: 1000,
      p_output_tokens: 500,
      p_cache_read_tokens: 20_000,
      p_cache_write_tokens: 4_000,
    });
  });

  it("records nothing when a throwing callback reported no spend", async () => {
    const { runAi } = await import("@/lib/ai/gateway");

    await expect(
      runAi(
        { orgId: ORG_ID, userId: "user-1", feature: "ask_pulse" },
        async () => {
          throw new Error("died before the first call");
        },
      ),
    ).rejects.toThrow("died before the first call");

    expect(rpc).not.toHaveBeenCalledWith("record_ai_usage", expect.anything());
  });

  // The other half: a successful run must still be metered EXACTLY once, from
  // the usage it returned — never once for the report and again for the result.
  it("meters a successful run once, from the returned usage", async () => {
    const { runAi } = await import("@/lib/ai/gateway");

    await runAi(
      { orgId: ORG_ID, userId: "user-1", feature: "personal_agent_run" },
      async (_resolved, reportUsage) => {
        reportUsage({ inputTokens: 999, outputTokens: 999 });
        return {
          result: "ok",
          usage: { inputTokens: 1000, outputTokens: 500 },
        };
      },
    );

    const ledgerWrites = rpc.mock.calls.filter(
      (c) => c[0] === "record_ai_usage",
    );
    expect(ledgerWrites).toHaveLength(1);
    expect(ledgerWrites[0]?.[1]).toMatchObject({
      p_input_tokens: 1000,
      p_output_tokens: 500,
    });
  });

  it("defaults cache token counts to 0 when the adapter omits them", async () => {
    const { runAi } = await import("@/lib/ai/gateway");

    await runAi(
      { orgId: ORG_ID, userId: "user-1", feature: "item_assist" },
      async () => ({
        result: "ok",
        usage: { inputTokens: 100, outputTokens: 50 },
      }),
    );

    expect(rpc).toHaveBeenCalledWith(
      "record_ai_usage",
      expect.objectContaining({
        p_cache_read_tokens: 0,
        p_cache_write_tokens: 0,
      }),
    );
  });
});

describe("runEmbedding", () => {
  it("passes cache token counts through to record_ai_usage (via typedRpc)", async () => {
    // requireAiEntitlement → readOrgAiSettings hits the same maybeSingle mock as
    // resolveAiAdapter; any non-"off", non-"managed" mode short-circuits to an
    // unmetered entitlement without touching `rpc`, leaving it free to assert on.
    settingsRow("org_byo");
    rpc.mockResolvedValue({ data: null, error: null });
    const { runEmbedding } = await import("@/lib/ai/gateway");

    const out = await runEmbedding(
      { orgId: ORG_ID, userId: "user-1", feature: "item_embed" },
      async () => ({
        result: "ok",
        usage: {
          inputTokens: 800,
          outputTokens: 0,
          cacheReadTokens: 5_000,
          cacheWriteTokens: 1_000,
        },
        model: "text-embedding-3-small",
      }),
    );

    expect(out).toBe("ok");
    expect(rpc).toHaveBeenCalledWith(
      "record_ai_usage",
      expect.objectContaining({
        p_org: ORG_ID,
        p_user: "user-1",
        p_feature: "item_embed",
        p_provider: "openai",
        p_model: "text-embedding-3-small",
        p_input_tokens: 800,
        p_output_tokens: 0,
        p_cache_read_tokens: 5_000,
        p_cache_write_tokens: 1_000,
      }),
    );
  });
});
