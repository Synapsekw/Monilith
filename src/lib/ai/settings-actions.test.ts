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
