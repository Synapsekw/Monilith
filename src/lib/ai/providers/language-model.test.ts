import { describe, expect, it } from "vitest";
import { languageModelFor } from "./language-model";

/**
 * These assert on the REAL model instance the real provider factory builds —
 * `modelId` is proof that the wire id we were asked for is the one that would
 * be dispatched, not merely echoed back out of our own argument.
 */
describe("languageModelFor", () => {
  it("builds an Anthropic model on the WIRE id", () => {
    const m = languageModelFor({
      kind: "anthropic",
      apiKey: "k",
      baseUrl: null,
      model: "claude-sonnet-5-20260101",
    });
    expect(m).toMatchObject({
      modelId: "claude-sonnet-5-20260101",
      provider: "anthropic.messages",
    });
  });

  it("builds an OpenAI model", () => {
    const m = languageModelFor({
      kind: "openai",
      apiKey: "k",
      baseUrl: null,
      model: "gpt-5",
    });
    expect(m).toMatchObject({ modelId: "gpt-5" });
  });

  it("builds a Google model", () => {
    const m = languageModelFor({
      kind: "google",
      apiKey: "k",
      baseUrl: null,
      model: "gemini-3-pro",
    });
    expect(m).toMatchObject({ modelId: "gemini-3-pro" });
  });

  it("builds an openai-compatible model on its row's baseUrl", () => {
    const m = languageModelFor({
      kind: "openai-compatible",
      apiKey: "k",
      baseUrl: "https://api.moonshot.ai/v1",
      model: "kimi-k2",
    });
    expect(m).toMatchObject({ modelId: "kimi-k2" });
  });

  // A missing baseUrl would otherwise silently POST to the SDK's default host
  // with somebody else's key.
  it("refuses an openai-compatible model with no baseUrl", () => {
    expect(() =>
      languageModelFor({
        kind: "openai-compatible",
        apiKey: "k",
        baseUrl: null,
        model: "kimi-k2",
      }),
    ).toThrow(/baseUrl/);
  });
});
