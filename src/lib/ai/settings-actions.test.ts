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
        ((v: UpdateResult) => TResult1 | PromiseLike<TResult1>) | null,
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

/**
 * `ai_providers` health writes, as a recording-and-APPLYING fake — the same
 * shape, and the same reasoning, as the `org_ai_settings` fake above.
 *
 * `recordProviderVerification` is NOT module-mocked here: the real one runs
 * against this fake, so what a test asserts is the actual UPDATE payload and
 * the actual predicate set. That matters twice over. `.eq("id", provider)` is
 * the only thing narrowing a save-time health write to ONE provider — the
 * table is a platform-wide registry with no per-user or per-org column — so a
 * lost predicate must show up as a write that stamped every seeded provider,
 * not as a silently green call count. And `last_verified_at` must appear on an
 * `ok` and be absent on a `failed`, which is a claim about the patch itself.
 */
type RecordedProviderUpdate = {
  patch: Record<string, unknown>;
  predicates: Predicate[];
  /** Which seeded provider ids the recorded predicates actually matched. */
  matched: string[];
};
const providerUpdates: RecordedProviderUpdate[] = [];
let providerUpdateError: { message: string } | null = null;
let providerUpdateThrows = false;

function makeProviderUpdate(patch: Record<string, unknown>) {
  // A synchronous throw from the query builder, so the "telemetry can never
  // fail the save" claim is exercised at its harshest.
  if (providerUpdateThrows) throw new Error("registry unavailable");
  const predicates: Predicate[] = [];
  let recorded = false;

  const settle = (): { error: { message: string } | null } => {
    const matched = Object.values(providers).filter((r) =>
      predicates.every((p) => r[p.column] === p.value),
    );
    if (!recorded) {
      recorded = true;
      providerUpdates.push({
        patch: { ...patch },
        predicates: [...predicates],
        matched: matched.map((r) => String(r.id)),
      });
    }
    if (providerUpdateError) return { error: providerUpdateError };
    for (const row of matched) Object.assign(row, patch);
    return { error: null };
  };

  const builder = {
    eq(column: string, value: unknown) {
      predicates.push({ column, value });
      return builder;
    },
    then<TResult1 = { error: { message: string } | null }, TResult2 = never>(
      onFulfilled?:
        | ((v: {
            error: { message: string } | null;
          }) => TResult1 | PromiseLike<TResult1>)
        | null,
      onRejected?: ((r: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): Promise<TResult1 | TResult2> {
      return Promise.resolve(settle()).then(onFulfilled, onRejected);
    },
  };
  return builder;
}

/** The single health write a save should have produced. */
const soleProviderUpdate = (): RecordedProviderUpdate => {
  expect(providerUpdates).toHaveLength(1);
  return providerUpdates[0];
};

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
          update: (patch: Record<string, unknown>) => makeProviderUpdate(patch),
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

/**
 * PARTIAL mock of the provider-rows seam. Everything real is kept — including
 * `getProviderRow` and `recordProviderVerification` itself, so the recording
 * fake above still observes the genuine UPDATE payload and predicate set.
 *
 * The one thing it adds is a way to make the recorder BREAK its never-throws
 * contract. That contract is why the helper cannot be made to throw from the
 * client side (it catches around `client.from(...).update(...)` inclusive), and
 * therefore why `setOrgByoKey`'s own belt-and-braces catch is unreachable
 * through the fake alone: without this override, deleting that try/catch left
 * the whole suite green. A guard no test can fail is not a guard.
 */
const { recordHealthOverride } = vi.hoisted(() => ({
  recordHealthOverride: { fn: null as null | (() => Promise<void>) },
}));
vi.mock("@/lib/ai/providers/provider-rows", async (importActual) => {
  const actual =
    await importActual<typeof import("@/lib/ai/providers/provider-rows")>();
  return {
    ...actual,
    recordProviderVerification: (
      ...args: Parameters<typeof actual.recordProviderVerification>
    ) =>
      recordHealthOverride.fn
        ? recordHealthOverride.fn()
        : actual.recordProviderVerification(...args),
  };
});

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
  providerUpdates.length = 0;
  providerUpdateError = null;
  providerUpdateThrows = false;
  recordHealthOverride.fn = null;
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

/**
 * The org key is VERIFIED on save, and that live probe used to be discarded —
 * so a provider an admin had just keyed and validated still read "Never
 * checked" on Settings → AI until the nightly sweep ran, which for an
 * org-BYO-only provider is never (decision-39: the sweep reads personal
 * credentials only). Nothing is borrowed here; only the result of a check the
 * admin themselves triggered is kept.
 *
 * SUCCESS ONLY. `ai_providers` has no tenant column, so a `failed` written
 * from this action would publish ONE organisation's credential problem as a
 * vendor outage to every other tenant. The tests below pin both halves: the
 * `ok` patch and its predicate, and silence on every failure path.
 */
describe("setOrgByoKey — save-time provider health", () => {
  const saveMistral = async (key = "sk-mistral-valid-key") => {
    admin(true);
    svcRpc.mockResolvedValue({ data: null, error: null });
    const { setOrgByoKey } = await import("@/lib/ai/settings-actions");
    return setOrgByoKey({ provider: "mistral", key });
  };

  it("stamps `ok` on the verified provider's row and nothing else", async () => {
    validateKey.mockResolvedValue(undefined);
    const res = await saveMistral();
    expect(res.ok).toBe(true);

    const write = soleProviderUpdate();
    // The predicate IS the scope. `ai_providers` is platform-wide, so losing
    // `.eq("id", …)` would stamp every provider in the registry.
    expect(write.predicates).toEqual([{ column: "id", value: "mistral" }]);
    expect(write.matched).toEqual(["mistral"]);
    expect(write.patch).toMatchObject({
      last_verify_status: "ok",
      last_verify_error: null,
    });
    // An `ok` moves BOTH stamps; that is what makes the row read "verified
    // just now" instead of "never checked".
    expect(write.patch.last_verified_at).toEqual(expect.any(String));
    expect(write.patch.last_verify_attempt_at).toEqual(expect.any(String));
    // The bystander provider must be untouched.
    expect(providers.anthropic.last_verify_status).toBeUndefined();
    // No key material, ever, in a row every authenticated user can read.
    expect(JSON.stringify(write.patch)).not.toContain("valid-key");
  });

  it("writes NO health row when the provider rejects the org key", async () => {
    // The admin still learns the key was rejected. Every other tenant's badge
    // is left exactly as it was — one org's bad credential is not a vendor
    // outage, and the nightly sweep remains the authority on failures.
    const { ProviderAuthError } = await import("@/lib/ai/providers/types");
    validateKey.mockRejectedValue(new ProviderAuthError("mistral"));

    const res = await saveMistral();

    expect(res).toEqual({
      ok: false,
      error: "That key was rejected by mistral.",
    });
    expect(providerUpdates).toHaveLength(0);
    expect(providers.mistral.last_verify_status).toBeUndefined();
    expect(providers.mistral.last_verify_attempt_at).toBeUndefined();
    expect(svcRpc).not.toHaveBeenCalled();
  });

  it("writes NO health row when the provider could not be reached", async () => {
    validateKey.mockRejectedValue(
      new Error("connect ECONNREFUSED https://api.mistral.ai?key=sekrit"),
    );

    const res = await saveMistral("sk-mistral-supersecret");

    expect(res).toEqual({
      ok: false,
      error: "Couldn't verify the key. Please try again.",
    });
    expect(providerUpdates).toHaveLength(0);
    expect(providers.mistral.last_verify_status).toBeUndefined();
  });

  it("writes no health row when the key never reached the provider", async () => {
    // A shape rejection is not a probe outcome; inventing one would report a
    // check that never ran.
    admin(true);
    const { setOrgByoKey } = await import("@/lib/ai/settings-actions");
    const res = await setOrgByoKey({
      provider: "anthropic",
      key: "sk-not-an-anthropic-key",
    });
    expect(res.ok).toBe(false);
    expect(validateKey).not.toHaveBeenCalled();
    expect(providerUpdates).toHaveLength(0);
  });

  it("still saves the key when the health write errors", async () => {
    validateKey.mockResolvedValue(undefined);
    providerUpdateError = { message: "registry write denied" };
    const res = await saveMistral();
    expect(res.ok).toBe(true);
    expect(svcRpc).toHaveBeenCalledWith(
      "org_ai_secret_set",
      expect.objectContaining({ p_org: "org-1", p_provider: "mistral" }),
    );
  });

  it("still saves the key when the registry query builder throws outright", async () => {
    // Absorbed one layer down, by `recordProviderVerification`'s never-throws
    // contract — this asserts the contract holds end-to-end through the action.
    validateKey.mockResolvedValue(undefined);
    providerUpdateThrows = true;
    const res = await saveMistral();
    expect(res.ok).toBe(true);
    expect(svcRpc).toHaveBeenCalledWith(
      "org_ai_secret_set",
      expect.objectContaining({ p_provider: "mistral" }),
    );
  });

  it("still saves the key when the recorder itself breaks its never-throws contract", async () => {
    // The belt-and-braces case: telemetry must not be able to fail a save even
    // if a future recorder stops swallowing. This is the ONLY test that reaches
    // `setOrgByoKey`'s own try/catch — deleting that catch turns it red.
    validateKey.mockResolvedValue(undefined);
    recordHealthOverride.fn = async () => {
      throw new Error("registry unavailable");
    };
    const res = await saveMistral();
    expect(res.ok).toBe(true);
    expect(svcRpc).toHaveBeenCalledWith(
      "org_ai_secret_set",
      expect.objectContaining({ p_org: "org-1", p_provider: "mistral" }),
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

// The org-wide clamp on what ANY personal agent may be granted — Task 8's
// per-agent `CapabilityToggles` disables anything outside this set, and the
// run loop re-intersects it at run time (see `route.test.ts`); this action is
// only the persistence half.
describe("setAgentCapabilityCeiling", () => {
  it("rejects non-admins", async () => {
    admin(false);
    const { setAgentCapabilityCeiling } =
      await import("@/lib/ai/settings-actions");
    const res = await setAgentCapabilityCeiling({
      capabilities: ["board.write"],
    });
    expect(res).toEqual({
      ok: false,
      error: "Only organization admins can change AI settings.",
    });
    expect(settingsUpdates).toHaveLength(0);
  });

  // capabilitySchema is z.enum(AGENT_CAPABILITIES) — an unknown string must
  // never reach the update, and must be refused before the admin check even
  // runs a query, exactly like `keySchema`/`modeSchema` above.
  it("rejects an unknown capability before any write", async () => {
    admin(true);
    const { setAgentCapabilityCeiling } =
      await import("@/lib/ai/settings-actions");
    const res = await setAgentCapabilityCeiling({
      // @ts-expect-error — deliberately outside the vocabulary
      capabilities: ["board.write", "sudo.everything"],
    });
    expect(res.ok).toBe(false);
    expect(settingsUpdates).toHaveLength(0);
    expect(rlsRpc).not.toHaveBeenCalled();
  });

  it("rejects a duplicate capability", async () => {
    admin(true);
    const { setAgentCapabilityCeiling } =
      await import("@/lib/ai/settings-actions");
    const res = await setAgentCapabilityCeiling({
      capabilities: ["board.write", "board.write"],
    });
    expect(res.ok).toBe(false);
    expect(settingsUpdates).toHaveLength(0);
  });

  it("stores the narrowed set for admins", async () => {
    admin(true);
    const { setAgentCapabilityCeiling } =
      await import("@/lib/ai/settings-actions");
    const res = await setAgentCapabilityCeiling({
      capabilities: ["board.write", "time.log"],
    });
    expect(res.ok).toBe(true);
    expect(rowFor("org-1")).toMatchObject({
      agent_capability_ceiling: ["board.write", "time.log"],
      updated_by: "user-1",
    });
  });

  // An admin closing the gate entirely is a valid, deliberate choice — the
  // schema has no minimum length.
  it("accepts an empty set, closing the gate for every agent in the org", async () => {
    admin(true);
    const { setAgentCapabilityCeiling } =
      await import("@/lib/ai/settings-actions");
    const res = await setAgentCapabilityCeiling({ capabilities: [] });
    expect(res.ok).toBe(true);
    expect(rowFor("org-1")).toMatchObject({ agent_capability_ceiling: [] });
  });

  // Same tenant-boundary shape as setOrgDefaultModel: this write runs on the
  // SERVICE client, which bypasses RLS, so `.eq("org_id", …)` is the only
  // thing stopping one org's ceiling from becoming every org's.
  it("touches ONLY the caller's org row", async () => {
    admin(true);
    const bystander = { ...rowFor("org-2") };
    const { setAgentCapabilityCeiling } =
      await import("@/lib/ai/settings-actions");
    expect(
      (await setAgentCapabilityCeiling({ capabilities: ["time.log"] })).ok,
    ).toBe(true);
    expect(settingsUpdates).toHaveLength(1);
    expect(settingsUpdates[0].matched).toBe(1);
    expect(settingsUpdates[0].predicates).toEqual([
      { column: "org_id", value: "org-1" },
    ]);
    expect(rowFor("org-2")).toEqual(bystander);
  });

  it("never creates a settings row, and says so when there is none", async () => {
    admin(true);
    settingsTable = [settingsRow("org-2")];
    const { setAgentCapabilityCeiling } =
      await import("@/lib/ai/settings-actions");
    expect(
      await setAgentCapabilityCeiling({ capabilities: ["board.write"] }),
    ).toEqual({
      ok: false,
      error: "Choose how AI is powered for this organization first.",
    });
    expect(svcUpsert).not.toHaveBeenCalled();
  });

  it("reports a failed write instead of claiming success", async () => {
    admin(true);
    settingsUpdateError = { message: "boom" };
    const { setAgentCapabilityCeiling } =
      await import("@/lib/ai/settings-actions");
    expect(
      await setAgentCapabilityCeiling({ capabilities: ["board.write"] }),
    ).toEqual({
      ok: false,
      error: "Couldn't update the capability ceiling. Please try again.",
    });
  });
});

describe("setAssistantName", () => {
  // The name is org-admin-editable CONTENT, not an entitlement — but it is
  // still written on the SERVICE client, and there is deliberately no
  // authenticated write policy on `org_ai_settings` at all. This check is the
  // whole authorization boundary for the rename.
  it("rejects non-admins", async () => {
    admin(false);
    const { setAssistantName } = await import("@/lib/ai/settings-actions");
    expect(await setAssistantName({ name: "Ada" })).toEqual({
      ok: false,
      error: "Only organization admins can change AI settings.",
    });
    expect(settingsUpdates).toHaveLength(0);
  });

  it("rejects a blank name before any write", async () => {
    admin(true);
    const { setAssistantName } = await import("@/lib/ai/settings-actions");
    const res = await setAssistantName({ name: "   " });
    expect(res.ok).toBe(false);
    expect(settingsUpdates).toHaveLength(0);
    expect(rlsRpc).not.toHaveBeenCalled();
  });

  // The column carries `check (length(trim(assistant_name)) between 1 and 40)`.
  // Without this the write reaches Postgres and comes back as an opaque failure
  // the form cannot attach to the field.
  it("rejects a name over the column's 40-character limit before any write", async () => {
    admin(true);
    const { setAssistantName } = await import("@/lib/ai/settings-actions");
    const res = await setAssistantName({ name: "x".repeat(41) });
    expect(res.ok).toBe(false);
    expect(settingsUpdates).toHaveLength(0);
    expect(rlsRpc).not.toHaveBeenCalled();
  });

  it("stores the trimmed name for admins", async () => {
    admin(true);
    const { setAssistantName } = await import("@/lib/ai/settings-actions");
    const res = await setAssistantName({ name: "  Ada  " });
    expect(res).toEqual({ ok: true, data: { name: "Ada" } });
    expect(rowFor("org-1")).toMatchObject({
      assistant_name: "Ada",
      updated_by: "user-1",
    });
  });

  // Same tenant-boundary shape as every other write in this module: the
  // service client bypasses RLS, so `.eq("org_id", …)` is the only thing
  // stopping one org's rename from renaming the assistant for everybody.
  it("touches ONLY the caller's org row", async () => {
    admin(true);
    const bystander = { ...rowFor("org-2") };
    const { setAssistantName } = await import("@/lib/ai/settings-actions");
    expect((await setAssistantName({ name: "Ada" })).ok).toBe(true);
    expect(settingsUpdates).toHaveLength(1);
    expect(settingsUpdates[0].matched).toBe(1);
    expect(settingsUpdates[0].predicates).toEqual([
      { column: "org_id", value: "org-1" },
    ]);
    expect(rowFor("org-2")).toEqual(bystander);
  });

  it("never creates a settings row, and says so when there is none", async () => {
    admin(true);
    settingsTable = [settingsRow("org-2")];
    const { setAssistantName } = await import("@/lib/ai/settings-actions");
    expect(await setAssistantName({ name: "Ada" })).toEqual({
      ok: false,
      error: "Choose how AI is powered for this organization first.",
    });
    expect(svcUpsert).not.toHaveBeenCalled();
  });

  it("reports a failed write instead of claiming success", async () => {
    admin(true);
    settingsUpdateError = { message: "boom" };
    const { setAssistantName } = await import("@/lib/ai/settings-actions");
    expect(await setAssistantName({ name: "Ada" })).toEqual({
      ok: false,
      error: "Couldn't rename the assistant. Please try again.",
    });
  });
});

describe("getOrgAiSettings", () => {
  // The form's initial value. Without it the field renders the default for
  // every org and an admin's saved name only appears after a hard reload.
  it("surfaces the org's assistant name", async () => {
    rlsMaybeSingle.mockResolvedValue({
      data: { ai_mode: "managed", assistant_name: "Ada" },
      error: null,
    } as never);
    const { getOrgAiSettings } = await import("@/lib/ai/settings-actions");
    const res = await getOrgAiSettings();
    expect(res.ok && res.data.assistantName).toBe("Ada");
  });

  it("falls back to the product default when the org has no settings row", async () => {
    rlsMaybeSingle.mockResolvedValue({ data: null, error: null } as never);
    const { getOrgAiSettings } = await import("@/lib/ai/settings-actions");
    const res = await getOrgAiSettings();
    expect(res.ok && res.data.assistantName).toBe("Monolith Autopilot");
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

  it("setAssistantName", async () => {
    admin(true);
    const { setAssistantName } = await import("@/lib/ai/settings-actions");
    expect((await setAssistantName({ name: "Ada" })).ok).toBe(true);
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

  it("setAgentCapabilityCeiling", async () => {
    admin(true);
    const { setAgentCapabilityCeiling } =
      await import("@/lib/ai/settings-actions");
    expect(
      (await setAgentCapabilityCeiling({ capabilities: ["board.write"] })).ok,
    ).toBe(true);
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
