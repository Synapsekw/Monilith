import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const maybeSingle = vi.fn();
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    rpc,
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
  }),
}));

const resolveUserAdapter = vi.fn();
vi.mock("@/lib/ai/credentials", () => ({
  resolveUserAdapter: (...a: unknown[]) => resolveUserAdapter(...a),
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
    await expect(resolveAiAdapter("org-1")).rejects.toMatchObject({
      name: "AiDisabledError",
    });
  });

  it("managed → anthropic adapter + env key; missing env key → AiNotConfiguredError", async () => {
    settingsRow("managed");
    const { resolveAiAdapter } = await import("@/lib/ai/gateway");
    await expect(resolveAiAdapter("org-1")).rejects.toMatchObject({
      name: "AiNotConfiguredError",
    });
    process.env.TEST_MANAGED_KEY = "sk-ant-managed";
    const r = await resolveAiAdapter("org-1");
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
    const r = await resolveAiAdapter("org-1");
    expect(rpc).toHaveBeenCalledWith("org_ai_secret_get", { p_org: "org-1" });
    expect(r).toMatchObject({
      mode: "org_byo",
      provider: "google",
      apiKey: "g-key",
    });

    rpc.mockResolvedValueOnce({ data: [], error: null });
    await expect(resolveAiAdapter("org-1")).rejects.toMatchObject({
      name: "ByoKeyMissingError",
    });
  });

  it("per_user (and missing row) → resolveUserAdapter passthrough", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    resolveUserAdapter.mockResolvedValue({
      adapter: anthropicAdapter,
      apiKey: "sk-user",
    });
    const { resolveAiAdapter } = await import("@/lib/ai/gateway");
    const r = await resolveAiAdapter("org-1");
    expect(r).toMatchObject({ mode: "per_user", apiKey: "sk-user" });
  });
});

describe("runAi", () => {
  it("invokes fn with the resolved adapter and records a ledger row", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    resolveUserAdapter.mockResolvedValue({
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
  });

  it("a failed ledger write does not fail the call", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    resolveUserAdapter.mockResolvedValue({
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
