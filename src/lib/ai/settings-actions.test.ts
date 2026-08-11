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

/**
 * `org_ai_settings` as a recording-and-APPLYING fake — the shape
 * `src/test/ai-models-fake-client.ts` established, and for the same reason.
 *
 * The predecessor here took `.update(values).eq(col, val)` and threw the
 * `.eq` arguments on the floor. That `.eq("org_id", ctx.orgId)` is the ONLY
 * tenant boundary on these two writes: they run on the SERVICE client, which
 * bypasses RLS entirely, so deleting the filter would set (or clear) the
 * default model for EVERY organization in the database — and all twelve tests
 * stayed green. Here every predicate is
 *
 *   RECORDED, so the full predicate set is assertable, and
 *   APPLIED, so a missing filter makes the write stamp rows it had no
 *   business touching, against a table seeded with a SECOND org.
 */
type SettingsRow = Record<string, unknown>;
type Predicate = { column: string; value: unknown };
type RecordedUpdate = {
  patch: Record<string, unknown>;
  predicates: Predicate[];
  /** How many seeded rows the recorded predicates actually matched. */
  matched: number;
};
/** PostgREST's `{ error, count }` — a write that matched no row is visible. */
type UpdateResult = { error: { message: string } | null; count: number | null };

let settingsTable: SettingsRow[] = [];
const settingsUpdates: RecordedUpdate[] = [];
let settingsUpdateError: { message: string } | null = null;

const settingsRow = (orgId: string, over: SettingsRow = {}): SettingsRow => ({
  org_id: orgId,
  ai_mode: "per_user",
  default_provider: null,
  default_model_id: null,
  updated_by: null,
  ...over,
});

const rowFor = (orgId: string): SettingsRow | undefined =>
  settingsTable.find((r) => r.org_id === orgId);

function makeSettingsUpdate(patch: Record<string, unknown>) {
  const predicates: Predicate[] = [];
  let recorded = false;

  const settle = (): UpdateResult => {
    if (settingsUpdateError) return { error: settingsUpdateError, count: null };
    const matched = settingsTable.filter((r) =>
      predicates.every((p) => r[p.column] === p.value),
    );
    for (const row of matched) Object.assign(row, patch);
    if (!recorded) {
      recorded = true;
      settingsUpdates.push({
        patch: { ...patch },
        predicates: [...predicates],
        matched: matched.length,
      });
    }
    return { error: null, count: matched.length };
  };

  const builder = {
    eq(column: string, value: unknown) {
      predicates.push({ column, value });
      return builder;
    },
    // Thenable, so an update with NO `.eq` at all still resolves exactly like a
    // PostgREST builder — which is what makes dropping the org filter a
    // behaviour change the suite can see rather than a type error.
    then<TResult1 = UpdateResult, TResult2 = never>(
      onFulfilled?:
        | ((v: UpdateResult) => TResult1 | PromiseLike<TResult1>)
        | null,
      onRejected?: ((r: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): Promise<TResult1 | TResult2> {
      return Promise.resolve(settle()).then(onFulfilled, onRejected);
    },
  };
  return builder;
}

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
      // org_ai_settings
      return {
        select: () => ({ eq: () => ({ maybeSingle: svcMaybeSingle }) }),
        upsert: svcUpsert,
        update: (patch: Record<string, unknown>) => makeSettingsUpdate(patch),
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
// Hoisted so the PATH each mutation invalidates is assertable. `revalidatePath`
// without a `type` is NOT recursive, so a stale path here means the org AI form
// keeps rendering pre-mutation data until something else happens to bust it.
const { revalidatePath } = vi.hoisted(() => ({ revalidatePath: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath }));

// Id verification is a live third-party round-trip, so it is handed to `after`
// instead of being awaited on the response path — same shape, and same reason,
// as credentials-actions.test.ts. `after` throws outside a Next request scope,
// so capturing the tasks IS the assertion that the work was deferred.
const { afterTasks } = vi.hoisted(() => ({
  afterTasks: [] as (() => Promise<void>)[],
}));
vi.mock("next/server", async (importActual) => {
  const actual = await importActual<typeof import("next/server")>();
  return {
    ...actual,
    after: (task: () => Promise<void>) => void afterTasks.push(task),
  };
});

const verifyProviderModels = vi.fn();
vi.mock("@/lib/ai/models/verify-ids", () => ({
  verifyProviderModels: (...a: unknown[]) => verifyProviderModels(...a),
}));

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
  afterTasks.length = 0;
  verifyProviderModels.mockResolvedValue({ verified: 0, unverified: 0 });
  // TWO orgs, always. `org-2` is the bystander: it exists so that a write
  // which loses its `.eq("org_id", …)` visibly reaches a tenant it must never
  // touch, instead of being invisible against a single-row table.
  settingsTable = [
    settingsRow("org-1"),
    settingsRow("org-2", {
      default_provider: "anthropic",
      default_model_id: "claude-sonnet-5",
      updated_by: "someone-else",
    }),
  ];
  settingsUpdates.length = 0;
  settingsUpdateError = null;
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

// An org key is the only thing that can ask ITS provider which model ids the
// provider actually answers to — exactly like a personal key. Without this, an
// admin saves the org's Mistral key and the model picker still says "add an API
// key to see models" for Mistral, forever.
describe("setOrgByoKey — id verification", () => {
  const saveMistral = async () => {
    admin(true);
    validateKey.mockResolvedValue(undefined);
    svcRpc.mockResolvedValue({ data: null, error: null });
    const { setOrgByoKey } = await import("@/lib/ai/settings-actions");
    return setOrgByoKey({ provider: "mistral", key: "sk-mistral-valid-key" });
  };

  it("defers verification to after() instead of awaiting it on the response path", async () => {
    // A provider that accepts the connection and then stalls must not hold the
    // admin's "Validate & save" open.
    const res = await saveMistral();
    expect(res.ok).toBe(true);
    expect(afterTasks).toHaveLength(1);
    expect(verifyProviderModels).not.toHaveBeenCalled();
  });

  it("resolves that provider's catalog ids with the key it just saved", async () => {
    await saveMistral();
    await afterTasks[0]();
    expect(verifyProviderModels).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "mistral",
        apiKey: "sk-mistral-valid-key",
      }),
    );
  });

  it("does not verify when the key never reached the vault", async () => {
    admin(true);
    validateKey.mockResolvedValue(undefined);
    svcRpc.mockResolvedValue({ data: null, error: { message: "vault down" } });
    const { setOrgByoKey } = await import("@/lib/ai/settings-actions");
    const res = await setOrgByoKey({
      provider: "mistral",
      key: "sk-mistral-valid-key",
    });
    expect(res.ok).toBe(false);
    expect(afterTasks).toHaveLength(0);
  });

  it("does not verify when the provider rejected the key", async () => {
    admin(true);
    const { ProviderAuthError } = await import("@/lib/ai/providers/types");
    validateKey.mockRejectedValue(new ProviderAuthError("nope"));
    const { setOrgByoKey } = await import("@/lib/ai/settings-actions");
    const res = await setOrgByoKey({
      provider: "mistral",
      key: "sk-mistral-valid-key",
    });
    expect(res.ok).toBe(false);
    expect(afterTasks).toHaveLength(0);
    expect(verifyProviderModels).not.toHaveBeenCalled();
  });

  it("still saves the key when verification blows up", async () => {
    // The key is valid regardless; an unverified row is simply not offered
    // until the next pass. The deferred task must swallow rather than reject
    // into the platform, because nothing is left to observe it.
    verifyProviderModels.mockRejectedValueOnce(new Error("catalog offline"));
    const res = await saveMistral();
    expect(res.ok).toBe(true);
    await expect(afterTasks[0]()).resolves.toBeUndefined();
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
    expect(settingsUpdates).toHaveLength(0);
  });

  it("stores the provider and the CATALOG key for admins", async () => {
    admin(true);
    const { setOrgDefaultModel } = await import("@/lib/ai/settings-actions");
    const res = await setOrgDefaultModel({
      provider: "mistral",
      modelId: "mistral-small-latest",
    });
    expect(res.ok).toBe(true);
    expect(rowFor("org-1")).toMatchObject({
      default_provider: "mistral",
      default_model_id: "mistral-small-latest",
      updated_by: "user-1",
    });
  });

  /**
   * The tenant boundary, and the only one there is on this write.
   *
   * `setOrgDefaultModel` runs on the SERVICE client, which bypasses RLS — so
   * `.eq("org_id", ctx.orgId)` is not a nicety, it is the whole of the
   * isolation. Without it one admin's choice of default model becomes every
   * organization's, including which provider key their members now need.
   */
  it("touches ONLY the caller's org row", async () => {
    admin(true);
    const bystander = { ...rowFor("org-2") };
    const { setOrgDefaultModel } = await import("@/lib/ai/settings-actions");
    expect(
      (
        await setOrgDefaultModel({
          provider: "mistral",
          modelId: "mistral-small-latest",
        })
      ).ok,
    ).toBe(true);

    expect(settingsUpdates).toHaveLength(1);
    expect(settingsUpdates[0].matched).toBe(1);
    expect(settingsUpdates[0].predicates).toEqual([
      { column: "org_id", value: "org-1" },
    ]);
    expect(rowFor("org-2")).toEqual(bystander);
  });

  // The client sends a provider+model pair; neither is trusted. A model that is
  // not active must never become the org-wide fallback.
  it("refuses a model that is not in the catalog", async () => {
    admin(true);
    const { setOrgDefaultModel } = await import("@/lib/ai/settings-actions");
    expect(
      await setOrgDefaultModel({ provider: "anthropic", modelId: "made-up" }),
    ).toEqual({ ok: false, error: "That model isn't available." });
    expect(settingsUpdates).toHaveLength(0);
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
    expect(settingsUpdates).toHaveLength(0);
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
    expect(settingsUpdates).toHaveLength(0);
  });

  // UPDATE, never UPSERT: org_ai_settings.ai_mode defaults to 'per_user', so
  // inserting a row here would silently switch an org that has no row at all
  // (mode 'off' by DEFAULT_ORG_AI_SETTINGS) into per-user AI.
  it("never creates a settings row, and says so when there is none", async () => {
    admin(true);
    // No row for the caller's org at all — only the bystander's.
    settingsTable = [settingsRow("org-2")];
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
    settingsUpdateError = { message: "boom" };
    const { setOrgDefaultModel } = await import("@/lib/ai/settings-actions");
    expect(
      await setOrgDefaultModel({
        provider: "anthropic",
        modelId: "claude-sonnet-5",
      }),
    ).toEqual({ ok: false, error: "Couldn't save the default model." });
  });
});

describe("clearOrgDefaultModel", () => {
  it("rejects non-admins", async () => {
    admin(false);
    const { clearOrgDefaultModel } = await import("@/lib/ai/settings-actions");
    expect(await clearOrgDefaultModel()).toEqual({
      ok: false,
      error: "Only organization admins can change AI settings.",
    });
    expect(settingsUpdates).toHaveLength(0);
  });

  it("nulls BOTH halves of the default", async () => {
    // A catalog key is meaningless without its provider, so clearing one and
    // leaving the other would store a pair that can never resolve.
    admin(true);
    const { clearOrgDefaultModel } = await import("@/lib/ai/settings-actions");
    const bystander = { ...rowFor("org-2") };
    const res = await clearOrgDefaultModel();
    expect(res.ok).toBe(true);
    expect(rowFor("org-1")).toMatchObject({
      default_provider: null,
      default_model_id: null,
      updated_by: "user-1",
    });
    // Same service-client blast radius as setOrgDefaultModel: without
    // `.eq("org_id", …)` this would wipe every org's default in one call.
    expect(settingsUpdates[0].predicates).toEqual([
      { column: "org_id", value: "org-1" },
    ]);
    expect(settingsUpdates[0].matched).toBe(1);
    expect(rowFor("org-2")).toEqual(bystander);
  });

  it("is a no-op success for an org with no settings row, and creates none", async () => {
    // Nothing to clear is the outcome the caller wanted — same reasoning as
    // removeAiKey. Still never an upsert: see setOrgDefaultModel.
    admin(true);
    settingsTable = [settingsRow("org-2")];
    const { clearOrgDefaultModel } = await import("@/lib/ai/settings-actions");
    expect((await clearOrgDefaultModel()).ok).toBe(true);
    expect(svcUpsert).not.toHaveBeenCalled();
  });

  it("reports a failed write instead of claiming success", async () => {
    admin(true);
    settingsUpdateError = { message: "boom" };
    const { clearOrgDefaultModel } = await import("@/lib/ai/settings-actions");
    expect(await clearOrgDefaultModel()).toEqual({
      ok: false,
      error: "Couldn't clear the default model.",
    });
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

/**
 * Every mutation in this module is made from the org AI form, which lives at
 * `/settings/ai` — it moved off `/settings` in this branch.
 *
 * `revalidatePath(path)` with no `type` invalidates exactly ONE path and is
 * deliberately NOT recursive, so a mutation still naming `/settings` busts a
 * page the form is no longer on and leaves the page the admin is looking at
 * serving its pre-mutation render. Three of these five were left behind when
 * the page moved; this suite is what makes the next move loud.
 */
describe("revalidation names the page the form actually lives on", () => {
  const AI_SETTINGS_PATH = "/settings/ai";

  const paths = () => revalidatePath.mock.calls.map((c) => c[0]);

  it("setAiMode", async () => {
    admin(true);
    const { setAiMode } = await import("@/lib/ai/settings-actions");
    expect((await setAiMode({ mode: "off" })).ok).toBe(true);
    expect(paths()).toEqual([AI_SETTINGS_PATH]);
  });

  it("setOrgByoKey", async () => {
    admin(true);
    validateKey.mockResolvedValue(undefined);
    svcRpc.mockResolvedValue({ data: null, error: null });
    const { setOrgByoKey } = await import("@/lib/ai/settings-actions");
    expect(
      (await setOrgByoKey({ provider: "anthropic", key: "sk-ant-valid-key" }))
        .ok,
    ).toBe(true);
    expect(paths()).toEqual([AI_SETTINGS_PATH]);
  });

  it("removeOrgByoKey", async () => {
    admin(true);
    svcRpc.mockResolvedValue({ data: null, error: null });
    const { removeOrgByoKey } = await import("@/lib/ai/settings-actions");
    expect((await removeOrgByoKey()).ok).toBe(true);
    expect(paths()).toEqual([AI_SETTINGS_PATH]);
  });

  it("setOrgDefaultModel", async () => {
    admin(true);
    const { setOrgDefaultModel } = await import("@/lib/ai/settings-actions");
    expect(
      (
        await setOrgDefaultModel({
          provider: "anthropic",
          modelId: "claude-sonnet-5",
        })
      ).ok,
    ).toBe(true);
    expect(paths()).toEqual([AI_SETTINGS_PATH]);
  });

  it("clearOrgDefaultModel", async () => {
    admin(true);
    const { clearOrgDefaultModel } = await import("@/lib/ai/settings-actions");
    expect((await clearOrgDefaultModel()).ok).toBe(true);
    expect(paths()).toEqual([AI_SETTINGS_PATH]);
  });

  // A rejected mutation changed nothing, so it must not bust the page either.
  it("does not revalidate when the mutation was refused", async () => {
    admin(false);
    const { setAiMode } = await import("@/lib/ai/settings-actions");
    expect((await setAiMode({ mode: "off" })).ok).toBe(false);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
