import { describe, expect, it, vi } from "vitest";
import {
  ASSISTANT_NAME_MAX_LENGTH,
  DEFAULT_ASSISTANT_NAME,
  assistantNameSchema,
  resolveAssistantName,
} from "@/lib/org/assistant-name";
import {
  DEFAULT_ORG_AI_SETTINGS,
  readOrgAiSettings,
} from "@/lib/ai/org-settings";

/** A settings row minus one column — what an older row, or a narrowed select,
 *  actually hands `readOrgAiSettings`. */
function rowWithout(column: string) {
  const row: Record<string, unknown> = {
    ai_mode: "managed",
    tier: "pulse",
    monthly_credit_limit: 500,
    byo_provider: null,
    byo_key_last4: null,
    default_provider: null,
    default_model_id: null,
    max_agents_per_user: 3,
    max_agent_runs_per_user_per_day: 3,
    agent_capability_ceiling: ["board.write"],
    assistant_name: "Ada",
  };
  delete row[column];
  const maybeSingle = vi.fn(async () => ({ data: row, error: null }));
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  return { from: vi.fn(() => ({ select })) } as never;
}

describe("assistantNameSchema", () => {
  // The schema is the app-side mirror of the column's own constraint,
  // `check (length(trim(assistant_name)) between 1 and 40)`. If the two ever
  // disagree, a name the form accepts is refused by Postgres as a 500 with no
  // field to attach it to — so the bounds are asserted, not assumed.
  it("rejects an empty or over-long name", () => {
    expect(assistantNameSchema.safeParse("   ").success).toBe(false);
    expect(assistantNameSchema.safeParse("").success).toBe(false);
    expect(assistantNameSchema.safeParse("x".repeat(41)).success).toBe(false);
  });

  it("accepts a name up to 40 characters, and trims before measuring", () => {
    expect(assistantNameSchema.safeParse("x".repeat(40)).success).toBe(true);
    expect(assistantNameSchema.parse("  Ada  ")).toBe("Ada");
    // Padding is not length: the column measures the TRIMMED string too.
    expect(assistantNameSchema.safeParse(`  ${"x".repeat(40)}  `).success).toBe(
      true,
    );
  });

  // The field caps typing at this number, so it must be the schema's own
  // bound and not a hand-copied 40 that a later widening would leave behind.
  it("publishes its own maximum for the field to cap typing at", () => {
    expect(ASSISTANT_NAME_MAX_LENGTH).toBe(40);
    expect(
      assistantNameSchema.safeParse("x".repeat(ASSISTANT_NAME_MAX_LENGTH))
        .success,
    ).toBe(true);
    expect(
      assistantNameSchema.safeParse("x".repeat(ASSISTANT_NAME_MAX_LENGTH + 1))
        .success,
    ).toBe(false);
  });
});

describe("resolveAssistantName", () => {
  it("falls back to the default for a missing, blank or unusable value", () => {
    expect(resolveAssistantName(null)).toBe(DEFAULT_ASSISTANT_NAME);
    expect(resolveAssistantName(undefined)).toBe(DEFAULT_ASSISTANT_NAME);
    expect(resolveAssistantName("")).toBe(DEFAULT_ASSISTANT_NAME);
    expect(resolveAssistantName("   ")).toBe(DEFAULT_ASSISTANT_NAME);
  });

  it("returns the stored name, trimmed", () => {
    expect(resolveAssistantName("  Ada  ")).toBe("Ada");
  });
});

describe("readOrgAiSettings · assistantName", () => {
  it("defaults to Monolith Autopilot when the column is unset", async () => {
    const settings = await readOrgAiSettings(rowWithout("assistant_name"), "o");
    expect(settings.assistantName).toBe(DEFAULT_ASSISTANT_NAME);
  });

  it("reads the stored name when the column is set", async () => {
    const settings = await readOrgAiSettings(rowWithout("tier"), "o");
    expect(settings.assistantName).toBe("Ada");
  });

  // A row-less org still has to be CALLED something — every render site takes
  // the resolved name, so a missing settings row must not render an empty label.
  it("names the assistant for an org with no settings row at all", () => {
    expect(DEFAULT_ORG_AI_SETTINGS.assistantName).toBe(DEFAULT_ASSISTANT_NAME);
  });
});
