import { describe, it, expect } from "vitest";
import {
  AGENT_TEMPLATES,
  AGENT_CADENCES,
  boardScopeSchema,
  personalAgentSettingsSchema,
  INSTRUCTIONS_MAX,
} from "./agent-config";
import { AGENT_CAPABILITIES } from "./capabilities";
import { slugifyHandle } from "./handle";

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
        handle: slugifyHandle(t.name, t.id),
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
    handle: "ops",
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

  // The other half-state. It WOULD resolve at run time (resolveModel falls back
  // to that provider's cheapest model at the feature's tier), but the editor's
  // picker can only express a concrete model — so allowing it would mean the
  // editor silently clears a pin it is unable to show.
  it("rejects a provider pinned without a model", () => {
    const r = personalAgentSettingsSchema.safeParse({
      ...base,
      provider: "moonshotai",
      modelId: null,
    });
    expect(r.success).toBe(false);
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

// ── Capability grants, cadence and the wider prompt cap ───────────────────
// Every expectation below mirrors a check constraint added by
// 20260812060142_agent_capabilities_and_cadence: `user_agents_capabilities_known`,
// `user_agents_cadence_check`, `user_agents_cadence_fields` and the widened
// `user_agents_instructions_check`. Zod has to reject exactly what Postgres
// rejects — anything Zod lets through becomes a constraint violation the user
// reads as "Couldn't save that agent".
describe("personalAgentSettingsSchema — grants and cadence", () => {
  const base = {
    name: "A",
    handle: "ops",
    templateId: "morning-brief",
    instructions: "do the thing",
    boardScope: { mode: "all" as const },
    runAtLocalHour: 7,
    enabled: true,
    provider: null,
    modelId: null,
    capabilities: [],
    runOnWeekday: null,
    runOnDayOfMonth: null,
  };

  it("allows an 8000-character prompt", () => {
    expect(INSTRUCTIONS_MAX).toBe(8000);
    const r = personalAgentSettingsSchema.safeParse({
      ...base,
      cadence: "daily",
      instructions: "x".repeat(8000),
    });
    expect(r.success).toBe(true);
  });

  it("rejects an unknown capability", () => {
    const r = personalAgentSettingsSchema.safeParse({
      ...base,
      cadence: "daily",
      capabilities: ["board.delete"],
    });
    expect(r.success).toBe(false);
  });

  it("accepts every capability in the vocabulary", () => {
    const r = personalAgentSettingsSchema.safeParse({
      ...base,
      cadence: "daily",
      capabilities: [...AGENT_CAPABILITIES],
    });
    expect(r.success).toBe(true);
  });

  // A grant set is a SET. A duplicate is never intentional and would be stored
  // verbatim in a text[], so it is refused rather than silently de-duplicated.
  it("rejects a duplicated capability", () => {
    const r = personalAgentSettingsSchema.safeParse({
      ...base,
      cadence: "daily",
      capabilities: ["board.write", "board.write"],
    });
    expect(r.success).toBe(false);
  });

  // The default is what makes this feature opt-in: an editor that predates the
  // capability picker sends no `capabilities` key at all, and that agent must
  // arrive at the insert as exactly as read-only as it is today.
  it("defaults an absent grant set to none", () => {
    const r = personalAgentSettingsSchema.safeParse({
      ...base,
      cadence: "daily",
      capabilities: undefined,
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.capabilities).toEqual([]);
  });

  it("ships the five cadences the check constraint allows", () => {
    expect([...AGENT_CADENCES]).toEqual([
      "daily",
      "weekdays",
      "weekly",
      "monthly",
      // Spec 3. A manual agent never occupies a fire slot — it runs only when
      // it is delegated to or addressed by handle.
      "manual",
    ]);
  });

  it("accepts the manual cadence with neither day operand", () => {
    const r = personalAgentSettingsSchema.safeParse({
      ...base,
      cadence: "manual",
    });
    expect(r.success).toBe(true);
  });

  it("rejects a day operand on the manual cadence", () => {
    for (const over of [{ runOnWeekday: 3 }, { runOnDayOfMonth: 12 }]) {
      const r = personalAgentSettingsSchema.safeParse({
        ...base,
        cadence: "manual",
        ...over,
      });
      expect(r.success).toBe(false);
    }
  });

  it("requires a handle", () => {
    const { handle: _handle, ...withoutHandle } = base;
    expect(
      personalAgentSettingsSchema.safeParse({
        ...withoutHandle,
        cadence: "daily",
      }).success,
    ).toBe(false);
  });

  it("rejects a handle the mention grammar could not carry", () => {
    for (const handle of ["a", "Ops", "ops chaser", "everyone"]) {
      const r = personalAgentSettingsSchema.safeParse({
        ...base,
        cadence: "daily",
        handle,
      });
      expect(r.success, handle).toBe(false);
    }
  });

  it("rejects a cadence outside the vocabulary", () => {
    const r = personalAgentSettingsSchema.safeParse({
      ...base,
      cadence: "hourly",
    });
    expect(r.success).toBe(false);
  });

  it("requires a weekday for the weekly cadence", () => {
    const r = personalAgentSettingsSchema.safeParse({
      ...base,
      cadence: "weekly",
      runOnWeekday: null,
    });
    expect(r.success).toBe(false);
  });

  it("accepts a weekly cadence with a weekday", () => {
    const r = personalAgentSettingsSchema.safeParse({
      ...base,
      cadence: "weekly",
      runOnWeekday: 3,
    });
    expect(r.success).toBe(true);
  });

  it("rejects a weekday on the daily cadence", () => {
    const r = personalAgentSettingsSchema.safeParse({
      ...base,
      cadence: "daily",
      runOnWeekday: 3,
    });
    expect(r.success).toBe(false);
  });

  it("rejects a day-of-month on the weekdays cadence", () => {
    const r = personalAgentSettingsSchema.safeParse({
      ...base,
      cadence: "weekdays",
      runOnDayOfMonth: 12,
    });
    expect(r.success).toBe(false);
  });

  it("rejects a weekly cadence carrying both day fields", () => {
    const r = personalAgentSettingsSchema.safeParse({
      ...base,
      cadence: "weekly",
      runOnWeekday: 3,
      runOnDayOfMonth: 12,
    });
    expect(r.success).toBe(false);
  });

  it("requires a day-of-month for the monthly cadence", () => {
    const r = personalAgentSettingsSchema.safeParse({
      ...base,
      cadence: "monthly",
      runOnDayOfMonth: null,
    });
    expect(r.success).toBe(false);
  });

  it("accepts a monthly cadence on day 28", () => {
    const r = personalAgentSettingsSchema.safeParse({
      ...base,
      cadence: "monthly",
      runOnDayOfMonth: 28,
    });
    expect(r.success).toBe(true);
  });

  it("rejects day 29 — not every month has one", () => {
    const r = personalAgentSettingsSchema.safeParse({
      ...base,
      cadence: "monthly",
      runOnDayOfMonth: 29,
    });
    expect(r.success).toBe(false);
  });

  it("rejects a weekday outside 0-6", () => {
    for (const day of [-1, 7]) {
      const r = personalAgentSettingsSchema.safeParse({
        ...base,
        cadence: "weekly",
        runOnWeekday: day,
      });
      expect(r.success, `weekday ${day} must be rejected`).toBe(false);
    }
  });

  // The cadence pair is one decision, so the message belongs on the control the
  // user actually operates — an error filed under `runOnWeekday` would point at
  // a field the editor only shows once the cadence is already weekly.
  it("files the cadence-pair error on cadence", () => {
    const r = personalAgentSettingsSchema.safeParse({
      ...base,
      cadence: "weekly",
      runOnWeekday: null,
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.flatten().fieldErrors.cadence?.[0]).toBeTruthy();
    }
  });
});
