import { describe, expect, it, vi, beforeEach } from "vitest";
import { ProviderAuthError } from "@/lib/ai/providers/types";

// --- Anthropic SDK stub ---
const anthropicList = vi.fn();
const anthropicParse = vi.fn();
// vi.mock factories are hoisted above normal top-level statements, so a plain
// `class AnthropicAuthError extends Error {}` referenced inside the factory's
// `static AuthenticationError = AnthropicAuthError` field initializer would hit
// the TDZ (ReferenceError: Cannot access before initialization). vi.hoisted()
// runs eagerly during the same hoisting pass, so the binding is ready in time.
const AnthropicAuthError = vi.hoisted(() => class extends Error {});
vi.mock("@anthropic-ai/sdk", () => {
  class Anthropic {
    static AuthenticationError = AnthropicAuthError;
    models = { list: (...a: unknown[]) => anthropicList(...a) };
    messages = { parse: (...a: unknown[]) => anthropicParse(...a) };
    constructor(readonly opts: { apiKey: string }) {}
  }
  return { default: Anthropic };
});
vi.mock("@anthropic-ai/sdk/helpers/json-schema", () => ({
  jsonSchemaOutputFormat: () => ({}),
}));

// --- OpenAI SDK stub ---
const openaiList = vi.fn();
const openaiCreate = vi.fn();
// Same TDZ hazard as AnthropicAuthError above — hoist via vi.hoisted().
const OpenAIAuthError = vi.hoisted(() => class extends Error {});
vi.mock("openai", () => {
  class OpenAI {
    static AuthenticationError = OpenAIAuthError;
    models = { list: (...a: unknown[]) => openaiList(...a) };
    chat = { completions: { create: (...a: unknown[]) => openaiCreate(...a) } };
    constructor(readonly opts: { apiKey: string }) {}
  }
  return { default: OpenAI };
});

// --- Google GenAI stub ---
const googleList = vi.fn();
const googleGenerate = vi.fn();
vi.mock("@google/genai", () => {
  class GoogleGenAI {
    models = {
      list: (...a: unknown[]) => googleList(...a),
      generateContent: (...a: unknown[]) => googleGenerate(...a),
    };
    constructor(readonly opts: { apiKey: string }) {}
  }
  return { GoogleGenAI };
});

import { anthropicAdapter } from "@/lib/ai/providers/anthropic";
import { openaiAdapter } from "@/lib/ai/providers/openai";
import { googleAdapter } from "@/lib/ai/providers/google";
import { getAdapter } from "@/lib/ai/providers/registry";

const PROPOSAL = { name: "X", widgets: [] };

beforeEach(() => {
  [
    anthropicList,
    anthropicParse,
    openaiList,
    openaiCreate,
    googleList,
    googleGenerate,
  ].forEach((m) => m.mockReset());
});

describe("registry", () => {
  it("maps each provider id to its adapter", () => {
    expect(getAdapter("anthropic").id).toBe("anthropic");
    expect(getAdapter("openai").id).toBe("openai");
    expect(getAdapter("google").id).toBe("google");
  });
});

describe("keyFormat", () => {
  it("rejects wrong prefixes and accepts right ones", () => {
    expect(anthropicAdapter.keyFormat.safeParse("sk-oops").success).toBe(false);
    expect(anthropicAdapter.keyFormat.safeParse("sk-ant-123").success).toBe(
      true,
    );
    expect(openaiAdapter.keyFormat.safeParse("nope").success).toBe(false);
    expect(openaiAdapter.keyFormat.safeParse("sk-123").success).toBe(true);
  });
});

describe("validateKey", () => {
  it("anthropic: resolves on success, throws ProviderAuthError on 401", async () => {
    anthropicList.mockResolvedValueOnce({});
    await expect(
      anthropicAdapter.validateKey("sk-ant-ok"),
    ).resolves.toBeUndefined();
    anthropicList.mockRejectedValueOnce(new AnthropicAuthError("bad"));
    await expect(
      anthropicAdapter.validateKey("sk-ant-bad"),
    ).rejects.toBeInstanceOf(ProviderAuthError);
  });

  it("openai: throws ProviderAuthError on 401", async () => {
    openaiList.mockRejectedValueOnce(new OpenAIAuthError("bad"));
    await expect(openaiAdapter.validateKey("sk-bad")).rejects.toBeInstanceOf(
      ProviderAuthError,
    );
  });

  it("google: throws ProviderAuthError when the list call fails", async () => {
    googleList.mockImplementationOnce(() => {
      throw new Error("API key not valid");
    });
    await expect(googleAdapter.validateKey("AIza-bad")).rejects.toBeInstanceOf(
      ProviderAuthError,
    );
  });

  it("anthropic: propagates a non-auth error unmapped", async () => {
    anthropicList.mockRejectedValueOnce(new Error("network down"));
    const p = anthropicAdapter.validateKey("sk-ant-ok");
    await expect(p).rejects.toThrow("network down");
    await expect(p).rejects.not.toBeInstanceOf(ProviderAuthError);
  });

  it("openai: propagates a non-auth error unmapped", async () => {
    openaiList.mockRejectedValueOnce(new Error("network down"));
    const p = openaiAdapter.validateKey("sk-ok");
    await expect(p).rejects.toThrow("network down");
    await expect(p).rejects.not.toBeInstanceOf(ProviderAuthError);
  });
});

describe("generateProposal", () => {
  it("anthropic reads parsed_output", async () => {
    anthropicParse.mockResolvedValueOnce({
      content: [{ type: "text", text: JSON.stringify(PROPOSAL) }],
      parsed_output: PROPOSAL,
      usage: { input_tokens: 1200, output_tokens: 340 },
    });
    const res = await anthropicAdapter.generateProposal({
      apiKey: "k",
      system: "s",
      user: "u",
    });
    expect(res.proposal.name).toBe("X");
    expect(res.usage).toEqual({ inputTokens: 1200, outputTokens: 340 });
  });

  it("openai parses the JSON message content", async () => {
    openaiCreate.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify(PROPOSAL) } }],
      usage: { prompt_tokens: 800, completion_tokens: 200 },
    });
    const res = await openaiAdapter.generateProposal({
      apiKey: "k",
      system: "s",
      user: "u",
    });
    expect(res.proposal.name).toBe("X");
    expect(res.usage).toEqual({ inputTokens: 800, outputTokens: 200 });
  });

  it("google parses response.text", async () => {
    googleGenerate.mockResolvedValueOnce({ text: JSON.stringify(PROPOSAL) });
    const res = await googleAdapter.generateProposal({
      apiKey: "k",
      system: "s",
      user: "u",
    });
    expect(res.proposal.name).toBe("X");
    expect(res.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });
});

describe("supportsTools", () => {
  it("is true for anthropic and false for openai/google", () => {
    expect(anthropicAdapter.supportsTools).toBe(true);
    expect(openaiAdapter.supportsTools).toBe(false);
    expect(googleAdapter.supportsTools).toBe(false);
  });
});
