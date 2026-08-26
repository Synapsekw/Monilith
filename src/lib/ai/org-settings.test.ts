import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  DEFAULT_ORG_AI_SETTINGS,
  readOrgAiSettings,
  unpinnedDefaultModel,
  type OrgAiSettings,
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

  // ── The default is a SHARED SINGLETON, so it must be immutable ─────────
  //
  // `readOrgAiSettings` returns this exact object BY IDENTITY for every org
  // with no `org_ai_settings` row (org-settings.ts: `if (!data) return
  // DEFAULT_ORG_AI_SETTINGS`). One in-place `push`/`sort`/`splice` anywhere in
  // the process therefore rewrites the default for every such org for the
  // lifetime of the server — and `agentCapabilityCeiling` is the ADMIN half of
  // the agent permission gate, so a stray push there widens what personal
  // agents may do, silently and globally.
  //
  // Two call sites already hand-guard against this (route.ts's "never mutate
  // it in place" comment, and the defensive spread in
  // agent-tools.rls.integration.test.ts). Those guards stay; the freeze is what
  // makes them ENFORCEABLE rather than a convention — under ESM's strict mode
  // a violation throws at the mutation instead of corrupting the process.
  //
  // The freeze must be DEEP: freezing the object alone leaves the ceiling array
  // fully mutable, which is the one field that matters most.
  it("refuses a write to the shared default object", () => {
    expect(() => {
      DEFAULT_ORG_AI_SETTINGS.mode = "managed";
    }).toThrow(TypeError);
    expect(DEFAULT_ORG_AI_SETTINGS.mode).toBe("off");
  });

  it("refuses an in-place mutation of the capability ceiling", () => {
    expect(() =>
      DEFAULT_ORG_AI_SETTINGS.agentCapabilityCeiling.push("board.write"),
    ).toThrow(TypeError);
    expect(() =>
      DEFAULT_ORG_AI_SETTINGS.agentCapabilityCeiling.splice(0, 1),
    ).toThrow(TypeError);
    expect(DEFAULT_ORG_AI_SETTINGS.agentCapabilityCeiling).toEqual([
      "board.write",
      "files.write",
      "automation.create",
      "time.log",
    ]);
  });

  it("hands a row-less org the frozen object, ceiling included", async () => {
    const settings = await readOrgAiSettings(clientReturning(null), "org-1");
    expect(settings).toBe(DEFAULT_ORG_AI_SETTINGS);
    expect(Object.isFrozen(settings)).toBe(true);
    expect(Object.isFrozen(settings.agentCapabilityCeiling)).toBe(true);
  });

  it("throws on a DB error (fail closed, not fail open)", async () => {
    await expect(
      readOrgAiSettings(clientReturning(null, { message: "boom" }), "org-1"),
    ).rejects.toBeTruthy();
  });
});

// ===========================================================================
// unpinnedDefaultModel
// ===========================================================================
//
// The property under test is agreement with `resolveAiAdapter` (gateway.ts):
// it honours `defaultModelId` only when `defaultProvider` equals the provider
// the MODE resolves. Anything that predicts an unpinned run's model — the
// reference-document budget meter above all — has to agree with that, or it
// sizes a budget against a context window the run never gets.
describe("unpinnedDefaultModel", () => {
  const settings = (over: Partial<OrgAiSettings>): OrgAiSettings => ({
    ...DEFAULT_ORG_AI_SETTINGS,
    ...over,
  });

  it("managed: honours an anthropic default", () => {
    expect(
      unpinnedDefaultModel(
        settings({
          mode: "managed",
          defaultProvider: "anthropic",
          defaultModelId: "claude-sonnet-4.5",
        }),
      ),
    ).toEqual({ provider: "anthropic", modelId: "claude-sonnet-4.5" });
  });

  it("managed: IGNORES a non-anthropic default", () => {
    // The permitted-but-inert configuration: the platform key is Anthropic's,
    // so the run resolves an Anthropic model no matter what the org default
    // says. A meter that trusted this would budget a 1M-token OpenAI window,
    // accept 200k of documents, and watch the run silently drop all of them.
    expect(
      unpinnedDefaultModel(
        settings({
          mode: "managed",
          defaultProvider: "openai",
          defaultModelId: "gpt-5-1m",
        }),
      ),
    ).toBeNull();
  });

  it("org_byo: honours a default that matches byoProvider", () => {
    expect(
      unpinnedDefaultModel(
        settings({
          mode: "org_byo",
          byoProvider: "openai",
          defaultProvider: "openai",
          defaultModelId: "gpt-5",
        }),
      ),
    ).toEqual({ provider: "openai", modelId: "gpt-5" });
  });

  it("org_byo: IGNORES a default whose provider is not the org's one key", () => {
    expect(
      unpinnedDefaultModel(
        settings({
          mode: "org_byo",
          byoProvider: "openai",
          defaultProvider: "anthropic",
          defaultModelId: "claude-sonnet-4.5",
        }),
      ),
    ).toBeNull();
  });

  it("org_byo: IGNORES the default when no BYO provider is set at all", () => {
    expect(
      unpinnedDefaultModel(
        settings({
          mode: "org_byo",
          byoProvider: null,
          defaultProvider: "openai",
          defaultModelId: "gpt-5",
        }),
      ),
    ).toBeNull();
  });

  it("per_user: the default provider IS the resolved provider", () => {
    expect(
      unpinnedDefaultModel(
        settings({
          mode: "per_user",
          defaultProvider: "openai",
          defaultModelId: "gpt-5",
        }),
      ),
    ).toEqual({ provider: "openai", modelId: "gpt-5" });
  });

  it("off: nothing resolves, so nothing is predicted", () => {
    expect(
      unpinnedDefaultModel(
        settings({
          mode: "off",
          defaultProvider: "anthropic",
          defaultModelId: "claude-sonnet-4.5",
        }),
      ),
    ).toBeNull();
  });

  it("is null when either half of the default is unset", () => {
    expect(
      unpinnedDefaultModel(
        settings({
          mode: "managed",
          defaultProvider: "anthropic",
          defaultModelId: null,
        }),
      ),
    ).toBeNull();
    expect(
      unpinnedDefaultModel(
        settings({
          mode: "managed",
          defaultProvider: null,
          defaultModelId: "claude-sonnet-4.5",
        }),
      ),
    ).toBeNull();
  });
});
