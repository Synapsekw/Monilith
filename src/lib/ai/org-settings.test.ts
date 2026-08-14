import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
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

  it("missing row resolves to the default", async () => {
    const settings = await readOrgAiSettings(clientReturning(null), "org-1");
    expect(settings).toEqual(DEFAULT_ORG_AI_SETTINGS);
  });

  it("defaults a row-less org to no AI, not to per-user keys", () => {
    // The fallback is what an org with no org_ai_settings row gets. Under
    // managed-only billing that must be 'off': a brand-new org has not bought
    // anything, and 'per_user' would hand it a working AI surface for free.
    // Every org that existed before this change got an explicit 'per_user' row
    // written by 20260802133040_org_ai_settings_backfill, so nobody was moved.
    expect(DEFAULT_ORG_AI_SETTINGS.mode).toBe("off");
    expect(DEFAULT_ORG_AI_SETTINGS.monthlyCreditLimit).toBe(0);
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
        agent_capability_ceiling: ["board.write", "time.log"],
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
      agentCapabilityCeiling: ["board.write", "time.log"],
    });
  });

  // The ceiling is the ADMIN half of the two-key gate: an agent may only use a
  // capability its own grant set AND this list both contain. Reading it is
  // therefore a column, not an inference — and a column that is not in the
  // select list arrives as `undefined`, which would read as "no ceiling" at
  // every call site that spreads it.
  it("selects the capability ceiling column", async () => {
    const client = clientReturning(null);
    await readOrgAiSettings(client, "org-1");
    const select = (
      client as unknown as { from: () => { select: Mock } }
    ).from().select as Mock;
    expect(select.mock.calls[0]?.[0]).toContain("agent_capability_ceiling");
  });

  // The DEFAULT (no settings row) matches the column default: all four. Such an
  // org is `mode: "off"`, so no agent runs there whatever the ceiling says —
  // but the two must not disagree, or an org would silently lose capabilities
  // the moment its first settings row appeared.
  it("defaults a row-less org to the full ceiling, matching the column default", () => {
    expect(DEFAULT_ORG_AI_SETTINGS.agentCapabilityCeiling).toEqual([
      "board.write",
      "files.write",
      "automation.create",
      "time.log",
    ]);
  });

  // Belt and braces: the column is NOT NULL with a default, so this cannot
  // happen through any supported path — but if it ever did, an unreadable
  // ceiling must clamp to nothing rather than open the gate.
  it("treats a missing ceiling as no capabilities, not as all of them", async () => {
    const settings = await readOrgAiSettings(
      clientReturning({
        ai_mode: "managed",
        tier: "pulse",
        monthly_credit_limit: 500,
        byo_provider: null,
        byo_key_last4: null,
        max_agents_per_user: 5,
        max_agent_runs_per_user_per_day: 10,
        agent_capability_ceiling: null,
      }),
      "org-1",
    );
    expect(settings.agentCapabilityCeiling).toEqual([]);
  });

  it("throws on a DB error (fail closed, not fail open)", async () => {
    await expect(
      readOrgAiSettings(clientReturning(null, { message: "boom" }), "org-1"),
    ).rejects.toBeTruthy();
  });
});
