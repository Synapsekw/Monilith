import { describe, expect, it } from "vitest";
import { ALL_PROVIDERS, PROVIDER_CATALOG } from "@/lib/ai/providers/catalog";

describe("provider catalog", () => {
  it("lists exactly the three supported providers", () => {
    expect(ALL_PROVIDERS.map((p) => p.id)).toEqual([
      "anthropic",
      "openai",
      "google",
    ]);
  });

  it("has a human label and placeholder for each provider", () => {
    for (const p of ALL_PROVIDERS) {
      expect(PROVIDER_CATALOG[p.id].label.length).toBeGreaterThan(0);
      expect(PROVIDER_CATALOG[p.id].placeholder.length).toBeGreaterThan(0);
    }
  });
});
