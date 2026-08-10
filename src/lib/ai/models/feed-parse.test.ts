import { describe, expect, it } from "vitest";
import fixture from "@/lib/ai/models/feed-fixture.json";
import { parseFeed, tierFor } from "@/lib/ai/models/feed-parse";

const ENABLED = ["anthropic", "openai", "google", "mistral", "moonshotai"];

describe("tierFor", () => {
  it("bands by input price per Mtok", () => {
    expect(tierFor(0.1)).toBe("cheap");
    expect(tierFor(1)).toBe("cheap");
    expect(tierFor(3)).toBe("standard");
    expect(tierFor(5)).toBe("standard");
    expect(tierFor(15)).toBe("strong");
  });

  it("treats an unpriced model as standard rather than cheapest", () => {
    // A null price must never make a model look like the cheap default, or the
    // tier hint would route bulk features onto an unmetered model.
    expect(tierFor(null)).toBe("standard");
  });
});

describe("parseFeed", () => {
  const rows = parseFeed(fixture, ENABLED);

  it("drops non-language models", () => {
    expect(rows.find((r) => r.model_id === "flux-2-pro")).toBeUndefined();
  });

  it("drops models from providers that are not enabled", () => {
    expect(
      parseFeed(fixture, ["anthropic"]).every(
        (r) => r.provider === "anthropic",
      ),
    ).toBe(true);
  });

  it("splits gateway_id into provider and model_id", () => {
    const sonnet = rows.find((r) => r.model_id === "claude-sonnet-5");
    expect(sonnet).toBeDefined();
    expect(sonnet!.provider).toBe("anthropic");
    expect(sonnet!.gateway_id).toBe("anthropic/claude-sonnet-5");
  });

  it("derives supports_tools from the tags array", () => {
    const sonnet = rows.find((r) => r.model_id === "claude-sonnet-5");
    expect(sonnet!.supports_tools).toBe(true);
  });

  it("converts per-token prices to per-Mtok", () => {
    // Kimi K2 ships input 0.00000057 $/token => 0.57 $/Mtok.
    const kimi = rows.find((r) => r.model_id === "kimi-k2");
    expect(kimi!.input_price_per_mtok).toBeCloseTo(0.57, 6);
    expect(kimi!.tier).toBe("cheap");
  });

  it("marks a model with no pricing as needs_pricing", () => {
    const unpriced = rows.find((r) => r.model_id === "unpriced-test-model");
    expect(unpriced!.status).toBe("needs_pricing");
    expect(unpriced!.input_price_per_mtok).toBeNull();
  });

  it("leaves cache prices null when the provider publishes none", () => {
    const mistral = rows.find((r) => r.provider === "mistral");
    expect(mistral).toBeDefined();
    expect(mistral!.cache_read_price_per_mtok).toBeNull();
  });

  it("converts cache prices to per-Mtok when the provider publishes them", () => {
    // Claude Sonnet 5 ships input_cache_read 0.0000002 $/token => 0.2 $/Mtok
    // and input_cache_write 0.0000025 $/token => 2.5 $/Mtok.
    const sonnet = rows.find((r) => r.model_id === "claude-sonnet-5");
    expect(sonnet!.cache_read_price_per_mtok).toBeCloseTo(0.2, 6);
    expect(sonnet!.cache_write_price_per_mtok).toBeCloseTo(2.5, 6);
  });

  it("returns an empty array for a malformed payload instead of throwing", () => {
    expect(parseFeed({ nope: true }, ENABLED)).toEqual([]);
    expect(parseFeed(null, ENABLED)).toEqual([]);
  });
});
