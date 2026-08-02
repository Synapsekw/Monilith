import { describe, expect, it } from "vitest";
import {
  AI_FEATURES,
  DEFAULT_MODEL_CHOICE,
  modelFor,
} from "@/lib/ai/model-map";
import { PRICED_MODELS, computeCostUsd } from "@/lib/ai/pricing";

describe("model-map", () => {
  it("routes conversational and agentic features to sonnet-5", () => {
    for (const f of [
      "ask_pulse",
      "conversational_action",
      "automation_ai_step",
      "autopilot_run",
    ]) {
      expect(modelFor(f).model).toBe("claude-sonnet-5");
    }
  });

  it("routes short classification features to haiku-4-5", () => {
    expect(modelFor("item_assist").model).toBe("claude-haiku-4-5");
    expect(modelFor("column_fill").model).toBe("claude-haiku-4-5");
  });

  it("gives haiku the enabled-thinking shape and NO effort (haiku rejects effort)", () => {
    const haiku = modelFor("item_assist");
    expect(haiku.thinking).toEqual({ type: "enabled", budget_tokens: 1024 });
    expect(haiku.effort).toBeUndefined();
  });

  it("gives sonnet adaptive thinking with an effort level", () => {
    const sonnet = modelFor("ask_pulse");
    expect(sonnet.thinking).toEqual({ type: "adaptive" });
    expect(sonnet.effort).toBe("high");
  });

  it("falls back to the default choice for an unmapped feature", () => {
    expect(modelFor("not_a_feature")).toEqual(DEFAULT_MODEL_CHOICE);
  });

  it("does not fall into prototype chain lookup for Object methods", () => {
    expect(modelFor("constructor")).toEqual(DEFAULT_MODEL_CHOICE);
  });

  // The guard that matters: computeCostUsd returns 0 for an unpriced model, so
  // an unmapped model silently bills NOTHING.
  it("only emits models that are priced", () => {
    for (const f of AI_FEATURES) {
      expect(PRICED_MODELS).toContain(modelFor(f).model);
      expect(
        computeCostUsd(modelFor(f).model, {
          inputTokens: 1_000_000,
          outputTokens: 0,
        }),
      ).toBeGreaterThan(0);
    }
    expect(PRICED_MODELS).toContain(DEFAULT_MODEL_CHOICE.model);
  });
});
