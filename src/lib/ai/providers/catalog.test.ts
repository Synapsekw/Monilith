import { describe, expect, it } from "vitest";
import {
  ALL_PROVIDERS,
  PROVIDER_CATALOG,
  SEEDED_PROVIDERS,
} from "@/lib/ai/providers/catalog";

describe("provider catalog", () => {
  it("lists exactly the three natively-adapted providers", () => {
    expect(ALL_PROVIDERS.map((p) => p.id)).toEqual([
      "anthropic",
      "openai",
      "google",
    ]);
  });

  it("names all five seeded providers, including the openai-compatible pair", () => {
    expect([...SEEDED_PROVIDERS]).toEqual([
      "anthropic",
      "openai",
      "google",
      "mistral",
      "moonshotai",
    ]);
  });

  it("has a human label, placeholder and key format for each provider", () => {
    for (const p of ALL_PROVIDERS) {
      expect(PROVIDER_CATALOG[p.id].label.length).toBeGreaterThan(0);
      expect(PROVIDER_CATALOG[p.id].placeholder.length).toBeGreaterThan(0);
      expect(PROVIDER_CATALOG[p.id].keyFormat.length).toBeGreaterThan(0);
    }
  });
});

// The pre-flight shape check moved off ProviderAdapter (key formats are
// per-PROVIDER; one adapter serves several providers whose keys look nothing
// alike) and onto these regexes, which `saveAiKey` / `setOrgByoKey` apply. This
// is the coverage that used to live on `adapter.keyFormat`.
describe("keyFormat regexes", () => {
  const matches = (provider: string, key: string) =>
    new RegExp(PROVIDER_CATALOG[provider].keyFormat).test(key);

  it("rejects wrong prefixes and accepts right ones", () => {
    expect(matches("anthropic", "sk-oops")).toBe(false);
    expect(matches("anthropic", "sk-ant-123")).toBe(true);
    expect(matches("openai", "nope")).toBe(false);
    expect(matches("openai", "sk-123")).toBe(true);
    expect(matches("google", "sk-123")).toBe(false);
    expect(matches("google", "AIzaSyABC123")).toBe(true);
  });

  it("anchors at the start, so a prefix buried mid-key is not accepted", () => {
    expect(matches("anthropic", "junk-sk-ant-123")).toBe(false);
    expect(matches("google", "xAIza123")).toBe(false);
  });

  it("still matches the seeded ai_providers.key_format values", () => {
    // Tripwire for the drift this duplication invites: these are copied
    // verbatim from migration 20260810173752_ai_provider_registry.sql, and the
    // DB row is authoritative. Task 5/9 reads the row and deletes this copy.
    expect(PROVIDER_CATALOG.anthropic.keyFormat).toBe("^sk-ant-");
    expect(PROVIDER_CATALOG.openai.keyFormat).toBe("^sk-");
    expect(PROVIDER_CATALOG.google.keyFormat).toBe("^AIza");
  });
});
