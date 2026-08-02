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
});
