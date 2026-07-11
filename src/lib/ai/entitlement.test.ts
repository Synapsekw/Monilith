import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const maybeSingle = vi.fn();
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    rpc,
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
  }),
}));

function settingsRow(mode: string, limit = 0) {
  maybeSingle.mockResolvedValue({
    data: {
      ai_mode: mode,
      tier: "pro",
      monthly_credit_limit: limit,
      byo_provider: null,
      byo_key_last4: null,
    },
    error: null,
  });
}

beforeEach(() => vi.clearAllMocks());

describe("entitlement", () => {
  it("off → requireAiEntitlement throws AiDisabledError", async () => {
    settingsRow("off");
    const { requireAiEntitlement } = await import("@/lib/ai/entitlement");
    await expect(
      requireAiEntitlement("org-1", "ask_pulse"),
    ).rejects.toMatchObject({
      name: "AiDisabledError",
    });
  });

  it("managed within budget passes; exhausted throws AiQuotaExceededError", async () => {
    settingsRow("managed", 500);
    rpc.mockResolvedValueOnce({ data: 100, error: null });
    const { requireAiEntitlement, getAiEntitlement } =
      await import("@/lib/ai/entitlement");
    await expect(
      requireAiEntitlement("org-1", "dashboard_gen"),
    ).resolves.toBeUndefined();

    rpc.mockResolvedValueOnce({ data: 500, error: null });
    await expect(
      requireAiEntitlement("org-1", "dashboard_gen"),
    ).rejects.toMatchObject({
      name: "AiQuotaExceededError",
    });

    rpc.mockResolvedValueOnce({ data: 100, error: null });
    expect(await getAiEntitlement("org-1")).toEqual({
      mode: "managed",
      tier: "pro",
      creditsLimit: 500,
      creditsUsed: 100,
      creditsRemaining: 400,
    });
  });

  it("per_user and org_byo pass without a credit check", async () => {
    settingsRow("per_user");
    const { requireAiEntitlement } = await import("@/lib/ai/entitlement");
    await expect(
      requireAiEntitlement("org-1", "ask_pulse"),
    ).resolves.toBeUndefined();
    expect(rpc).not.toHaveBeenCalled();
  });
});
