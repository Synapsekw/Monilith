import { describe, expect, it } from "vitest";
import {
  AI_FEATURES,
  DEFAULT_TIER,
  requestShapeFor,
  tierForFeature,
} from "@/lib/ai/model-map";

describe("tierForFeature", () => {
  it("routes high-volume features to the cheap tier", () => {
    expect(tierForFeature("item_assist")).toBe("cheap");
    expect(tierForFeature("column_fill")).toBe("cheap");
  });

  it("routes tool-use and generation features to the standard tier", () => {
    for (const f of [
      "ask_pulse",
      "conversational_action",
      "automation_ai_step",
      "autopilot_run",
      "dashboard_gen",
    ])
      expect(tierForFeature(f)).toBe("standard");
  });

  // The LITERAL, not `DEFAULT_TIER` — asserting the constant against itself
  // is true for any value it could ever hold. Flipping it to "cheap" would
  // route every unmapped feature onto the cheapest model in the catalog
  // (bulk-tier economics applied to a feature nobody chose that for), and the
  // self-referential assertion would have stayed green through it.
  it("defaults an unmapped feature to the conservative middle", () => {
    expect(DEFAULT_TIER).toBe("standard");
    expect(tierForFeature("brand_new_feature")).toBe("standard");
  });

  it("does not fall into prototype chain lookup for Object methods", () => {
    // `Object.create(null)` is what makes this true; a plain object literal
    // would return the inherited Function for these keys.
    expect(tierForFeature("constructor")).toBe("standard");
    expect(tierForFeature("toString")).toBe("standard");
  });

  it("emits ONLY tiers — never a concrete model id", () => {
    // This is the regression guard: a model id here would be sent verbatim to
    // whichever provider the org's key belongs to, and 400 for four of five.
    for (const f of AI_FEATURES)
      expect(["cheap", "standard", "strong"]).toContain(tierForFeature(f));
  });

  it("still covers all 13 known features", () => {
    expect(AI_FEATURES).toHaveLength(13);
  });
});

// The request-shape half. It is keyed on the MODEL now, not the feature —
// `modelFor`, which returned a hardcoded `claude-*` id alongside the shape, is
// gone; `resolveModel` picks the model from the provider's own catalog.
describe("requestShapeFor", () => {
  it("gives the Haiku family the enabled-thinking shape and NO effort", () => {
    // Haiku 4.5 rejects output_config.effort outright — the key must be absent,
    // not undefined.
    for (const m of [
      "claude-haiku-4-5",
      "claude-haiku-4.5",
      "claude-haiku-5",
    ]) {
      const shape = requestShapeFor(m);
      expect(shape.thinking).toEqual({ type: "enabled", budget_tokens: 1024 });
      expect(shape.effort).toBeUndefined();
    }
  });

  it("gives every other model adaptive thinking with an effort level", () => {
    for (const m of [
      "claude-sonnet-5",
      "claude-opus-4-8",
      "gpt-5",
      "kimi-k2",
    ]) {
      const shape = requestShapeFor(m);
      expect(shape.thinking).toEqual({ type: "adaptive" });
      expect(shape.effort).toBe("high");
    }
  });

  it("matches the Haiku family in BOTH id namespaces", () => {
    // The Gateway catalog key is `claude-haiku-4.5`; Anthropic's own API wants
    // `claude-haiku-4-5`. Either can reach an adapter, and sending the
    // Sonnet-shaped request to Haiku is a 400.
    expect(requestShapeFor("claude-haiku-4.5")).toEqual(
      requestShapeFor("claude-haiku-4-5"),
    );
  });
});
