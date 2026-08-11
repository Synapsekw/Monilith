import { describe, it, expect } from "vitest";
import {
  AGENT_TEMPLATES,
  boardScopeSchema,
  personalAgentSettingsSchema,
  INSTRUCTIONS_MAX,
} from "./agent-config";

describe("agent templates", () => {
  it("ships four templates with unique ids", () => {
    expect(AGENT_TEMPLATES).toHaveLength(4);
    const ids = AGENT_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(4);
  });

  it("every template seeds a usable settings payload", () => {
    for (const t of AGENT_TEMPLATES) {
      const parsed = personalAgentSettingsSchema.safeParse({
        name: t.name,
        templateId: t.id,
        instructions: t.instructions,
        boardScope: t.boardScope,
        cadence: t.cadence,
        runAtLocalHour: t.runAtLocalHour,
        enabled: true,
      });
      expect(parsed.success, `${t.id} must seed valid settings`).toBe(true);
    }
  });
});

describe("boardScopeSchema", () => {
  it("accepts all-boards mode", () => {
    expect(boardScopeSchema.safeParse({ mode: "all" }).success).toBe(true);
  });

  it("accepts an explicit board list", () => {
    const r = boardScopeSchema.safeParse({
      mode: "list",
      boardIds: ["11111111-1111-4111-8111-111111111111"],
    });
    expect(r.success).toBe(true);
  });

  it("rejects a list mode with no boards", () => {
    expect(
      boardScopeSchema.safeParse({ mode: "list", boardIds: [] }).success,
    ).toBe(false);
  });

  it("rejects a non-uuid board id", () => {
    expect(
      boardScopeSchema.safeParse({ mode: "list", boardIds: ["nope"] }).success,
    ).toBe(false);
  });
});

describe("personalAgentSettingsSchema", () => {
  const base = {
    name: "Morning Brief",
    templateId: "morning-brief",
    instructions: "Summarise what is pending.",
    boardScope: { mode: "all" as const },
    cadence: "daily" as const,
    runAtLocalHour: 7,
    enabled: true,
  };

  it("accepts a valid payload", () => {
    expect(personalAgentSettingsSchema.safeParse(base).success).toBe(true);
  });

  it("rejects an empty name", () => {
    expect(
      personalAgentSettingsSchema.safeParse({ ...base, name: "" }).success,
    ).toBe(false);
  });

  it("rejects an hour outside 0-23", () => {
    expect(
      personalAgentSettingsSchema.safeParse({ ...base, runAtLocalHour: 24 })
        .success,
    ).toBe(false);
  });

  it("rejects instructions over the cap", () => {
    expect(
      personalAgentSettingsSchema.safeParse({
        ...base,
        instructions: "x".repeat(INSTRUCTIONS_MAX + 1),
      }).success,
    ).toBe(false);
  });

  // ── The per-agent model pin ─────────────────────────────────────────────
  // `provider` + `modelId` are the CATALOG key pair (ai_providers.id and
  // ai_models.model_id). Never the provider's wire id: `native_model_id` is
  // resolved at run time and only an adapter ever sees it, so a pin that
  // stored one would be unreadable by the picker and by the usage ledger.
  it("accepts a pinned provider and model", () => {
    const r = personalAgentSettingsSchema.safeParse({
      ...base,
      provider: "moonshotai",
      modelId: "kimi-k2",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.provider).toBe("moonshotai");
      expect(r.data.modelId).toBe("kimi-k2");
    }
  });

  it("treats a null provider+model as 'use the org default'", () => {
    const r = personalAgentSettingsSchema.safeParse({
      ...base,
      provider: null,
      modelId: null,
    });
    expect(r.success).toBe(true);
  });

  // Every agent predates the pin, so an omitted pair must mean "inherit"
  // rather than "invalid" — and must ARRIVE as null, because the actions
  // write it straight into two nullable columns.
  it("defaults an absent pin to null on both halves", () => {
    const r = personalAgentSettingsSchema.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.provider).toBeNull();
      expect(r.data.modelId).toBeNull();
    }
  });

  it("rejects a model pinned without a provider — the pair is meaningless alone", () => {
    const r = personalAgentSettingsSchema.safeParse({
      ...base,
      provider: null,
      modelId: "kimi-k2",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      // The message must land on `provider`, because that is the half the
      // user has to supply — an error filed under `modelId` would point at
      // the choice they already made.
      expect(r.error.flatten().fieldErrors.provider?.[0]).toMatch(/provider/i);
    }
  });

  // A provider with no model IS resolvable: resolveModel falls back to that
  // provider's cheapest model at the feature's tier. Pinning "run this agent
  // on Kimi, whichever model" must therefore stay legal.
  it("accepts a provider pinned without a model", () => {
    const r = personalAgentSettingsSchema.safeParse({
      ...base,
      provider: "moonshotai",
      modelId: null,
    });
    expect(r.success).toBe(true);
  });

  it("rejects an empty-string provider rather than storing one", () => {
    const r = personalAgentSettingsSchema.safeParse({
      ...base,
      provider: "   ",
      modelId: null,
    });
    expect(r.success).toBe(false);
  });
});
