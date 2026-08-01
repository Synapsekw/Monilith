import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const maybeSingle = vi.fn();
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    rpc,
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
  }),
}));

const resolveUserAdapterById = vi.fn();
vi.mock("@/lib/ai/credentials", () => ({
  resolveUserAdapterById: (...a: unknown[]) => resolveUserAdapterById(...a),
}));

vi.mock("@/lib/env.server", () => ({
  getServerEnv: () => ({ ANTHROPIC_API_KEY: process.env.TEST_MANAGED_KEY }),
}));

const anthropicAdapter = { id: "anthropic", supportsTools: true };
const googleAdapter = { id: "google", supportsTools: false };
vi.mock("@/lib/ai/providers/registry", () => ({
  getAdapter: (p: string) =>
    p === "google" ? googleAdapter : anthropicAdapter,
}));

function settingsRow(mode: string, extra: Record<string, unknown> = {}) {
  maybeSingle.mockResolvedValue({
    data: {
      ai_mode: mode,
      tier: "none",
      monthly_credit_limit: 0,
      byo_provider: null,
      byo_key_last4: null,
      ...extra,
    },
    error: null,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.TEST_MANAGED_KEY;
});

describe("resolveAiAdapter — 4-mode matrix", () => {
  it("off → AiDisabledError", async () => {
    settingsRow("off");
    const { resolveAiAdapter } = await import("@/lib/ai/gateway");
    await expect(resolveAiAdapter("org-1", "user-1")).rejects.toMatchObject({
      name: "AiDisabledError",
    });
  });

  it("managed → anthropic adapter + env key; missing env key → AiNotConfiguredError", async () => {
    settingsRow("managed");
    const { resolveAiAdapter } = await import("@/lib/ai/gateway");
    await expect(resolveAiAdapter("org-1", "user-1")).rejects.toMatchObject({
      name: "AiNotConfiguredError",
    });
    process.env.TEST_MANAGED_KEY = "sk-ant-managed";
    const r = await resolveAiAdapter("org-1", "user-1");
    expect(r).toMatchObject({
      mode: "managed",
      provider: "anthropic",
      apiKey: "sk-ant-managed",
    });
  });

  it("org_byo → org vault secret via rpc; no secret → ByoKeyMissingError", async () => {
    settingsRow("org_byo", { byo_provider: "google" });
    rpc.mockResolvedValueOnce({
      data: [{ provider: "google", secret: "g-key" }],
      error: null,
    });
    const { resolveAiAdapter } = await import("@/lib/ai/gateway");
    const r = await resolveAiAdapter("org-1", "user-1");
    expect(rpc).toHaveBeenCalledWith("org_ai_secret_get", { p_org: "org-1" });
    expect(r).toMatchObject({
      mode: "org_byo",
      provider: "google",
      apiKey: "g-key",
    });

    rpc.mockResolvedValueOnce({ data: [], error: null });
    await expect(resolveAiAdapter("org-1", "user-1")).rejects.toMatchObject({
      name: "ByoKeyMissingError",
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
      await resolveAiAdapter("org-1", "user-1");
    } catch (e) {
      caught = e;
    }
    expect(caught).toMatchObject({ message: "vault down" });
    expect((caught as { name?: string })?.name).not.toBe("ByoKeyMissingError");
  });

  it("per_user (and missing row) → resolveUserAdapterById passthrough, keyed on the SUPPLIED userId", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    resolveUserAdapterById.mockResolvedValue({
      adapter: anthropicAdapter,
      apiKey: "sk-user",
    });
    const { resolveAiAdapter } = await import("@/lib/ai/gateway");
    const r = await resolveAiAdapter("org-1", "user-42");
    expect(r).toMatchObject({ mode: "per_user", apiKey: "sk-user" });
    // The whole point of the fix: resolution is keyed on the caller-supplied
    // userId, not a session — never a different id than what runAi meters
    // against.
    expect(resolveUserAdapterById).toHaveBeenCalledWith("user-42");
  });

  it("per_user with no key on file → AiNotConfiguredError (a config state runAi callers can catch, not a raw crash)", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    const { AiNotConfiguredError } = await import("@/lib/ai/errors");
    resolveUserAdapterById.mockRejectedValue(new AiNotConfiguredError());
    const { resolveAiAdapter } = await import("@/lib/ai/gateway");
    await expect(resolveAiAdapter("org-1", "user-42")).rejects.toBeInstanceOf(
      AiNotConfiguredError,
    );
  });
});

describe("runAi", () => {
  it("invokes fn with the resolved adapter and records a ledger row", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    resolveUserAdapterById.mockResolvedValue({
      adapter: anthropicAdapter,
      apiKey: "sk-user",
    });
    rpc.mockResolvedValue({ data: null, error: null });
    const { runAi } = await import("@/lib/ai/gateway");

    const out = await runAi(
      { orgId: "org-1", userId: "u-1", feature: "dashboard_gen" },
      async () => ({
        result: "ok",
        usage: { inputTokens: 2000, outputTokens: 500 },
        model: "claude-opus-4-8",
      }),
    );

    expect(out).toBe("ok");
    expect(rpc).toHaveBeenCalledWith(
      "record_ai_usage",
      expect.objectContaining({
        p_org: "org-1",
        p_user: "u-1",
        p_feature: "dashboard_gen",
        p_provider: "anthropic",
        p_model: "claude-opus-4-8",
        p_input_tokens: 2000,
        p_output_tokens: 500,
        p_cost_usd: 0.0225,
        p_credits: 2.25,
      }),
    );
    // Credential resolution and ledger attribution must agree by
    // construction: the same "u-1" that gets billed is the id whose key ran.
    expect(resolveUserAdapterById).toHaveBeenCalledWith("u-1");
  });

  it("a failed ledger write does not fail the call", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    resolveUserAdapterById.mockResolvedValue({
      adapter: anthropicAdapter,
      apiKey: "sk-user",
    });
    rpc.mockResolvedValue({ data: null, error: { message: "ledger down" } });
    const { runAi } = await import("@/lib/ai/gateway");
    await expect(
      runAi({ orgId: "o", userId: "u", feature: "f" }, async () => ({
        result: 1,
        usage: { inputTokens: 0, outputTokens: 0 },
        model: "m",
      })),
    ).resolves.toBe(1);
  });
});
