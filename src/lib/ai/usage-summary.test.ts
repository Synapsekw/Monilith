import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => ({}) }));
vi.mock("@/lib/supabase/typed-rpc", () => ({ typedRpc: vi.fn() }));
vi.mock("@/lib/ai/entitlement", () => ({ getAiEntitlement: vi.fn() }));

import { typedRpc } from "@/lib/supabase/typed-rpc";
import { getAiEntitlement } from "@/lib/ai/entitlement";
import { getUsageSummary } from "@/lib/ai/usage-summary";

describe("getUsageSummary", () => {
  it("shapes the 6-month rollup, per-feature breakdown, and entitlement", async () => {
    vi.mocked(getAiEntitlement).mockResolvedValue({
      mode: "managed",
      tier: "pro",
      creditsLimit: 1000,
      creditsUsed: 250,
      creditsRemaining: 750,
    });
    vi.mocked(typedRpc).mockImplementation(((_client: unknown, fn: string) => {
      if (fn === "ai_usage_summary") {
        return Promise.resolve({
          data: [
            {
              month: "2026-08-01T00:00:00Z",
              credits: 250,
              cost_usd: 1.5,
              calls: 10,
            },
          ],
          error: null,
        });
      }
      if (fn === "ai_usage_by_feature_this_month") {
        return Promise.resolve({
          data: [{ feature: "ask_pulse", credits: 200, calls: 8 }],
          error: null,
        });
      }
      throw new Error(`unexpected rpc ${fn}`);
    }) as unknown as typeof typedRpc);

    const summary = await getUsageSummary("org-1");

    expect(summary.entitlement).toEqual({
      mode: "managed",
      tier: "pro",
      creditsUsed: 250,
      creditsLimit: 1000,
    });
    expect(summary.months).toEqual([
      { month: "2026-08-01T00:00:00Z", credits: 250, costUsd: 1.5, calls: 10 },
    ]);
    expect(summary.features).toEqual([
      { feature: "ask_pulse", credits: 200, calls: 8 },
    ]);
  });

  it("coerces an unmetered (Infinity) credits limit to null", async () => {
    vi.mocked(getAiEntitlement).mockResolvedValue({
      mode: "org_byo",
      tier: "none",
      creditsLimit: 0,
      creditsUsed: 0,
      creditsRemaining: Infinity,
    });
    vi.mocked(typedRpc).mockResolvedValue({
      data: [],
      error: null,
    } as unknown as Awaited<ReturnType<typeof typedRpc>>);

    const summary = await getUsageSummary("org-1");
    expect(summary.entitlement.creditsLimit).toBeNull();
  });
});
