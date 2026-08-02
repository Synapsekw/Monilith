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
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    rpc: svcRpc,
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: svcMaybeSingle }) }),
      upsert: svcUpsert,
    }),
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

const validateKey = vi.fn();
vi.mock("@/lib/ai/providers/registry", () => ({
  getAdapter: () => ({
    id: "anthropic",
    label: "Anthropic",
    keyFormat: {
      safeParse: (v: string) => ({ success: v.startsWith("sk-ant-") }),
    },
    validateKey: (...a: unknown[]) => validateKey(...a),
  }),
}));

const admin = (allowed: boolean) =>
  rlsRpc.mockResolvedValue({ data: allowed, error: null });

beforeEach(() => vi.clearAllMocks());

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
    expect(validateKey).toHaveBeenCalledWith("sk-ant-valid-key");
    expect(svcRpc).toHaveBeenCalledWith(
      "org_ai_secret_set",
      expect.objectContaining({
        p_org: "org-1",
        p_provider: "anthropic",
      }),
    );
    expect(res.ok).toBe(true);
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
