import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_ORG_AI_SETTINGS,
  readOrgAiSettings,
} from "@/lib/ai/org-settings";

function clientReturning(row: unknown, error: unknown = null) {
  const maybeSingle = vi.fn(async () => ({ data: row, error }));
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return { from } as never;
}

describe("readOrgAiSettings", () => {
  beforeEach(() => vi.clearAllMocks());

  it("missing row resolves to the per_user default", async () => {
    const settings = await readOrgAiSettings(clientReturning(null), "org-1");
    expect(settings).toEqual(DEFAULT_ORG_AI_SETTINGS);
    expect(settings.mode).toBe("per_user");
  });

  it("maps a row to the settings shape", async () => {
    const settings = await readOrgAiSettings(
      clientReturning({
        ai_mode: "managed",
        tier: "pulse",
        monthly_credit_limit: 500,
        byo_provider: null,
        byo_key_last4: null,
        max_agents_per_user: 5,
        max_agent_runs_per_user_per_day: 10,
      }),
      "org-1",
    );
    expect(settings).toEqual({
      mode: "managed",
      tier: "pulse",
      monthlyCreditLimit: 500,
      byoProvider: null,
      byoKeyLast4: null,
      maxAgentsPerUser: 5,
      maxAgentRunsPerUserPerDay: 10,
    });
  });

  it("throws on a DB error (fail closed, not fail open)", async () => {
    await expect(
      readOrgAiSettings(clientReturning(null, { message: "boom" }), "org-1"),
    ).rejects.toBeTruthy();
  });
});
