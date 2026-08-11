import { beforeEach, describe, expect, it, vi } from "vitest";

const svcRpc = vi.fn();
const svcMaybeSingle = vi.fn(
  async (): Promise<{
    data: Record<string, unknown> | null;
    error: unknown;
  }> => ({
    data: null,
    error: null,
  }),
);
const svcUpsert = vi.fn(async () => ({ error: null }));
// `.update(values, opts).eq(col, val)` — resolves to PostgREST's
// `{ error, count }`, so a write that matched no row is distinguishable.
const svcUpdateResult = vi.fn(async () => ({
  error: null as unknown,
  count: 1 as number | null,
}));
const svcUpdate = vi.fn((values: Record<string, unknown>) => {
  svcUpdate.lastValues = values;
  return { eq: (_c: string, _v: string) => svcUpdateResult() };
}) as ReturnType<typeof vi.fn> & { lastValues?: Record<string, unknown> };

// The catalog row `setOrgDefaultModel` validates against, keyed
// "provider/model_id". Absent => the picker offered something that is not in
// the catalog at all.
let models: Record<string, Record<string, unknown>> = {};
const modelFixture = (
  provider: string,
  modelId: string,
  status = "active",
) => ({
  provider,
  model_id: modelId,
  native_model_id: null,
  label: modelId,
  context_length: 200000,
  max_output_tokens: 8192,
  supports_tools: true,
  input_price_per_mtok: 1,
  output_price_per_mtok: 5,
  cache_read_price_per_mtok: null,
  cache_write_price_per_mtok: null,
  tier: "standard",
  status,
});

// The provider registry, keyed by id — `ai_providers` is the constraint now,
// so setOrgByoKey reads the row instead of a hardcoded three-member catalog.
let providers: Record<string, Record<string, unknown>> = {};
const providerFixture = (
  id: string,
  adapterKind: string,
  baseUrl: string | null,
  enabled = true,
) => ({
  id,
  label: id === "anthropic" ? "Anthropic (Claude)" : id,
  adapter_kind: adapterKind,
  base_url: baseUrl,
  key_placeholder: "sk-…",
  key_format: id === "anthropic" ? "^sk-ant-" : "^sk-",
  enabled,
});

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    rpc: svcRpc,
    from: (table: string) => {
      if (table === "ai_providers")
        return {
          select: () => ({
            eq: (_c: string, id: string) => ({
              maybeSingle: () =>
                Promise.resolve({ data: providers[id] ?? null, error: null }),
            }),
          }),
        };
      if (table === "ai_models")
        return {
          // getModel narrows on provider AND model_id, so `eq` chains twice.
          select: () => ({
            eq: (_c: string, provider: string) => ({
              eq: (_c2: string, modelId: string) => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: models[`${provider}/${modelId}`] ?? null,
                    error: null,
                  }),
              }),
            }),
          }),
        };
      return {
        select: () => ({ eq: () => ({ maybeSingle: svcMaybeSingle }) }),
        upsert: svcUpsert,
        update: svcUpdate,
      };
    },
  }),
}));

const rlsRpc = vi.fn();
const rlsMaybeSingle = vi.fn(async () => ({ data: null, error: null }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    rpc: rlsRpc,
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: rlsMaybeSingle }) }),
    }),
  })),
}));

vi.mock("@/lib/auth/session", () => ({
  requireUser: vi.fn(async () => ({ id: "user-1" })),
}));
vi.mock("@/lib/org/active", () => ({
  resolveActiveOrg: vi.fn(async () => ({
    id: "org-1",
    name: "Org",
    timezone: "UTC",
  })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// Mocked at the module boundary rather than through rlsRpc: readOrgBillingStatus
// goes through the same RLS client as has_org_role, so sharing that mock would
// make the admin check and the billing read indistinguishable.
const readOrgBillingStatus = vi.fn();
vi.mock("@/lib/billing/status", () => ({
  readOrgBillingStatus: (...a: unknown[]) => readOrgBillingStatus(...a),
}));
const billing = (status: string, tier = "pulse", seats = 4) =>
  readOrgBillingStatus.mockResolvedValue({
    tier,
    status,
    cadence: "annual",
    seats,
    currentPeriodEnd: null,
    trialEndsAt: null,
    graceEndsAt: null,
  });

// See credentials-actions.test.ts: key format + label are per-PROVIDER and no
// longer live on the (per-wire-format) adapter — they come off the row.
const validateKey = vi.fn();
vi.mock("@/lib/ai/providers/registry", () => ({
  getAdapter: (kind: string) => ({
    kind,
    validateKey: (...a: unknown[]) => validateKey(...a),
  }),
}));

const admin = (allowed: boolean) =>
  rlsRpc.mockResolvedValue({ data: allowed, error: null });

beforeEach(() => {
  vi.clearAllMocks();
  svcUpdateResult.mockResolvedValue({ error: null, count: 1 });
  models = {
    "anthropic/claude-sonnet-5": modelFixture("anthropic", "claude-sonnet-5"),
    "mistral/mistral-small-latest": modelFixture(
      "mistral",
      "mistral-small-latest",
    ),
    "mistral/mistral-retired": modelFixture(
      "mistral",
      "mistral-retired",
      "retired",
    ),
  };
  providers = {
    anthropic: providerFixture("anthropic", "anthropic", null),
    mistral: providerFixture(
      "mistral",
      "openai-compatible",
      "https://api.mistral.ai/v1",
    ),
  };
});

describe("org ai settings actions", () => {
  it("setOrgByoKey rejects non-admins", async () => {
    admin(false);
    const { setOrgByoKey } = await import("@/lib/ai/settings-actions");
    const res = await setOrgByoKey({
      provider: "anthropic",
      key: "sk-ant-valid-key",
    });
    expect(res).toEqual({
      ok: false,
      error: "Only organization admins can change AI settings.",
    });
    expect(svcRpc).not.toHaveBeenCalled();
  });

  it("setOrgByoKey validates then stores via org_ai_secret_set", async () => {
    admin(true);
    validateKey.mockResolvedValue(undefined);
    svcRpc.mockResolvedValue({ data: null, error: null });
    const { setOrgByoKey } = await import("@/lib/ai/settings-actions");
    const res = await setOrgByoKey({
      provider: "anthropic",
      key: "sk-ant-valid-key",
    });
    expect(validateKey).toHaveBeenCalledWith({
      apiKey: "sk-ant-valid-key",
      baseUrl: null,
    });
    expect(svcRpc).toHaveBeenCalledWith(
      "org_ai_secret_set",
      expect.objectContaining({
        p_org: "org-1",
        p_provider: "anthropic",
      }),
    );
    expect(res.ok).toBe(true);
  });

  it("setOrgByoKey accepts an openai-compatible provider and validates against ITS base url", async () => {
    // The whole point of the registry: Mistral and Kimi are rows, not a code
    // change. The three-member enum this replaced made them unreachable, and
    // validating without the base url would ping OpenAI with a Mistral key.
    admin(true);
    validateKey.mockResolvedValue(undefined);
    svcRpc.mockResolvedValue({ data: null, error: null });
    const { setOrgByoKey } = await import("@/lib/ai/settings-actions");
    const res = await setOrgByoKey({
      provider: "mistral",
      key: "sk-mistral-valid-key",
    });
    expect(validateKey).toHaveBeenCalledWith({
      apiKey: "sk-mistral-valid-key",
      baseUrl: "https://api.mistral.ai/v1",
    });
    expect(res.ok).toBe(true);
  });

  it("setOrgByoKey refuses a provider that is not an enabled row", async () => {
    admin(true);
    providers.mistral = providerFixture(
      "mistral",
      "openai-compatible",
      "https://api.mistral.ai/v1",
      false,
    );
    const { setOrgByoKey } = await import("@/lib/ai/settings-actions");
    expect(
      await setOrgByoKey({ provider: "mistral", key: "sk-mistral-valid-key" }),
    ).toEqual({ ok: false, error: "Unknown provider." });
    expect(
      await setOrgByoKey({ provider: "nope", key: "sk-whatever-key" }),
    ).toEqual({ ok: false, error: "Unknown provider." });
    expect(validateKey).not.toHaveBeenCalled();
    expect(svcRpc).not.toHaveBeenCalled();
  });

  it("setOrgByoKey rejects a key whose shape does not match the row's regex", async () => {
    admin(true);
    const { setOrgByoKey } = await import("@/lib/ai/settings-actions");
    const res = await setOrgByoKey({
      provider: "anthropic",
      key: "sk-not-an-anthropic-key",
    });
    expect(res).toEqual({
      ok: false,
      error: "That doesn't look like a Anthropic (Claude) key.",
    });
    expect(validateKey).not.toHaveBeenCalled();
  });

  it("setAiMode to org_byo without a stored key fails", async () => {
    admin(true);
    svcMaybeSingle.mockResolvedValueOnce({
      data: {
        ai_mode: "per_user",
        tier: "none",
        monthly_credit_limit: 0,
        byo_provider: null,
        byo_key_last4: null,
      },
      error: null,
    });
    const { setAiMode } = await import("@/lib/ai/settings-actions");
    const res = await setAiMode({ mode: "org_byo" });
    expect(res).toEqual({
      ok: false,
      error: "Add an organization key before switching to it.",
    });
  });

  it("setAiMode upserts for admins", async () => {
    admin(true);
    const { setAiMode } = await import("@/lib/ai/settings-actions");
    const res = await setAiMode({ mode: "off" });
    expect(svcUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        org_id: "org-1",
        ai_mode: "off",
        updated_by: "user-1",
      }),
      { onConflict: "org_id" },
    );
    expect(res.ok).toBe(true);
  });
});

// The self-grant hole: before this guard, an org admin could select "Managed"
// after a downgrade and resume spending against their previous credit pool —
// free AI, metered to our platform key. Managed is now derived from the
// subscription, not chosen by the customer.
describe("setAiMode — managed is derived from the subscription", () => {
  it("refuses managed when the org has no entitling subscription", async () => {
    admin(true);
    billing("none", "none", 0);
    const { setAiMode } = await import("@/lib/ai/settings-actions");
    const res = await setAiMode({ mode: "managed" });
    expect(res.ok).toBe(false);
    expect(svcUpsert).not.toHaveBeenCalled();
  });

  it("refuses managed while the org is in post-cancellation grace", async () => {
    admin(true);
    billing("grace");
    const { setAiMode } = await import("@/lib/ai/settings-actions");
    const res = await setAiMode({ mode: "managed" });
    expect(res.ok).toBe(false);
    expect(svcUpsert).not.toHaveBeenCalled();
  });

  it("allows managed on an active subscription", async () => {
    admin(true);
    billing("active");
    const { setAiMode } = await import("@/lib/ai/settings-actions");
    const res = await setAiMode({ mode: "managed" });
    expect(res.ok).toBe(true);
    expect(svcUpsert).toHaveBeenCalled();
  });

  it("allows managed during a trial", async () => {
    admin(true);
    billing("trialing", "trial", 1);
    const { setAiMode } = await import("@/lib/ai/settings-actions");
    const res = await setAiMode({ mode: "managed" });
    expect(res.ok).toBe(true);
  });

  it("zeroes the credit ceiling when switching to off", async () => {
    // The ceiling must not be left armed behind a disabled mode — otherwise any
    // path that re-enables managed resumes against the old pool.
    admin(true);
    const { setAiMode } = await import("@/lib/ai/settings-actions");
    const res = await setAiMode({ mode: "off" });
    expect(res.ok).toBe(true);
    expect(svcUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ ai_mode: "off", monthly_credit_limit: 0 }),
      { onConflict: "org_id" },
    );
  });

  it("leaves the ceiling alone for the unmetered modes", async () => {
    // org_byo and per_user cost us nothing, so their ceiling is irrelevant.
    // Zeroing it would silently destroy an Enterprise org's negotiated
    // allowance on a temporary toggle.
    admin(true);
    svcMaybeSingle.mockResolvedValueOnce({
      data: {
        ai_mode: "per_user",
        tier: "enterprise",
        monthly_credit_limit: 50_000,
        byo_provider: "anthropic",
        byo_key_last4: "1234",
      },
      error: null,
    });
    const { setAiMode } = await import("@/lib/ai/settings-actions");
    const res = await setAiMode({ mode: "org_byo" });
    expect(res.ok).toBe(true);
    expect(svcUpsert).toHaveBeenCalledWith(
      expect.not.objectContaining({
        monthly_credit_limit: expect.anything(),
      }),
      { onConflict: "org_id" },
    );
  });
});

describe("setOrgDefaultModel", () => {
  it("rejects non-admins", async () => {
    admin(false);
    const { setOrgDefaultModel } = await import("@/lib/ai/settings-actions");
    expect(
      await setOrgDefaultModel({
        provider: "anthropic",
        modelId: "claude-sonnet-5",
      }),
    ).toEqual({
      ok: false,
      error: "Only organization admins can change AI settings.",
    });
    expect(svcUpdate).not.toHaveBeenCalled();
  });

  it("stores the provider and the CATALOG key for admins", async () => {
    admin(true);
    const { setOrgDefaultModel } = await import("@/lib/ai/settings-actions");
    const res = await setOrgDefaultModel({
      provider: "mistral",
      modelId: "mistral-small-latest",
    });
    expect(res.ok).toBe(true);
    expect(svcUpdate.lastValues).toMatchObject({
      default_provider: "mistral",
      default_model_id: "mistral-small-latest",
      updated_by: "user-1",
    });
  });

  // The client sends a provider+model pair; neither is trusted. A model that is
  // not active must never become the org-wide fallback.
  it("refuses a model that is not in the catalog", async () => {
    admin(true);
    const { setOrgDefaultModel } = await import("@/lib/ai/settings-actions");
    expect(
      await setOrgDefaultModel({ provider: "anthropic", modelId: "made-up" }),
    ).toEqual({ ok: false, error: "That model isn't available." });
    expect(svcUpdate).not.toHaveBeenCalled();
  });

  it("refuses a retired model", async () => {
    admin(true);
    const { setOrgDefaultModel } = await import("@/lib/ai/settings-actions");
    expect(
      await setOrgDefaultModel({
        provider: "mistral",
        modelId: "mistral-retired",
      }),
    ).toEqual({ ok: false, error: "That model isn't available." });
    expect(svcUpdate).not.toHaveBeenCalled();
  });

  // listActiveModels does NOT join ai_providers.enabled, so "the model is
  // active" is not enough — a disabled provider's models are unrunnable.
  it("refuses a model whose provider is disabled", async () => {
    admin(true);
    providers.mistral = providerFixture(
      "mistral",
      "openai-compatible",
      "https://api.mistral.ai/v1",
      false,
    );
    const { setOrgDefaultModel } = await import("@/lib/ai/settings-actions");
    expect(
      await setOrgDefaultModel({
        provider: "mistral",
        modelId: "mistral-small-latest",
      }),
    ).toEqual({ ok: false, error: "Unknown provider." });
    expect(svcUpdate).not.toHaveBeenCalled();
  });

  // UPDATE, never UPSERT: org_ai_settings.ai_mode defaults to 'per_user', so
  // inserting a row here would silently switch an org that has no row at all
  // (mode 'off' by DEFAULT_ORG_AI_SETTINGS) into per-user AI.
  it("never creates a settings row, and says so when there is none", async () => {
    admin(true);
    svcUpdateResult.mockResolvedValue({ error: null, count: 0 });
    const { setOrgDefaultModel } = await import("@/lib/ai/settings-actions");
    expect(
      await setOrgDefaultModel({
        provider: "anthropic",
        modelId: "claude-sonnet-5",
      }),
    ).toEqual({
      ok: false,
      error: "Choose how AI is powered for this organization first.",
    });
    expect(svcUpsert).not.toHaveBeenCalled();
  });

  it("reports a failed write instead of claiming success", async () => {
    admin(true);
    svcUpdateResult.mockResolvedValue({
      error: { message: "boom" },
      count: null,
    });
    const { setOrgDefaultModel } = await import("@/lib/ai/settings-actions");
    expect(
      await setOrgDefaultModel({
        provider: "anthropic",
        modelId: "claude-sonnet-5",
      }),
    ).toEqual({ ok: false, error: "Couldn't save the default model." });
  });
});

describe("removeOrgByoKey", () => {
  it("rejects non-admins", async () => {
    admin(false);
    const { removeOrgByoKey } = await import("@/lib/ai/settings-actions");
    const res = await removeOrgByoKey();
    expect(res).toEqual({
      ok: false,
      error: "Only organization admins can change AI settings.",
    });
    expect(svcRpc).not.toHaveBeenCalled();
  });

  it("clears the key via org_ai_secret_clear for admins", async () => {
    admin(true);
    svcRpc.mockResolvedValue({ data: null, error: null });
    const { removeOrgByoKey } = await import("@/lib/ai/settings-actions");
    const res = await removeOrgByoKey();
    expect(svcRpc).toHaveBeenCalledWith("org_ai_secret_clear", {
      p_org: "org-1",
    });
    expect(res.ok).toBe(true);
  });
});
