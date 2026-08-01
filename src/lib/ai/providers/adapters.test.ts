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
const jsonSchemaOutputFormat = vi.hoisted(() => vi.fn(() => ({})));
vi.mock("@anthropic-ai/sdk/helpers/json-schema", () => ({
  jsonSchemaOutputFormat,
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
  jsonSchemaOutputFormat.mockClear();
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
    expect(res.usage).toEqual({
      inputTokens: 1200,
      outputTokens: 340,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
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

  it("openai falls back to zero usage when the response omits it", async () => {
    openaiCreate.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify(PROPOSAL) } }],
      usage: undefined,
    });
    const res = await openaiAdapter.generateProposal({
      apiKey: "k",
      system: "s",
      user: "u",
    });
    expect(res.proposal.name).toBe("X");
    expect(res.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
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

describe("generateStructured", () => {
  const SCHEMA = { type: "object", properties: { ok: { type: "boolean" } } };

  it("anthropic passes the schema through jsonSchemaOutputFormat and returns data + usage", async () => {
    anthropicParse.mockResolvedValueOnce({
      content: [{ type: "text", text: JSON.stringify({ ok: true }) }],
      parsed_output: { ok: true },
      usage: { input_tokens: 1, output_tokens: 2 },
    });
    const res = await anthropicAdapter.generateStructured({
      apiKey: "k",
      system: "s",
      user: "u",
      schema: SCHEMA,
    });
    expect(res.data).toEqual({ ok: true });
    expect(res.usage).toEqual({
      inputTokens: 1,
      outputTokens: 2,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
    expect(jsonSchemaOutputFormat).toHaveBeenCalledWith(SCHEMA);
  });

  it("anthropic falls back to parsing the text block when parsed_output is absent", async () => {
    anthropicParse.mockResolvedValueOnce({
      content: [{ type: "text", text: JSON.stringify({ ok: false }) }],
      usage: { input_tokens: 3, output_tokens: 4 },
    });
    const res = await anthropicAdapter.generateStructured({
      apiKey: "k",
      system: "s",
      user: "u",
      schema: SCHEMA,
    });
    expect(res.data).toEqual({ ok: false });
    expect(res.usage).toEqual({
      inputTokens: 3,
      outputTokens: 4,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
  });

  it("openai returns the parsed JSON body + usage and embeds the schema in the prompt", async () => {
    openaiCreate.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ ok: true }) } }],
      usage: { prompt_tokens: 5, completion_tokens: 6 },
    });
    const res = await openaiAdapter.generateStructured({
      apiKey: "k",
      system: "s",
      user: "u",
      schema: SCHEMA,
    });
    expect(res.data).toEqual({ ok: true });
    expect(res.usage).toEqual({ inputTokens: 5, outputTokens: 6 });
    const call = openaiCreate.mock.calls[0][0];
    expect(call.messages[1].content).toContain(JSON.stringify(SCHEMA));
  });

  it("google returns the parsed text body + usage and embeds the schema in the prompt", async () => {
    googleGenerate.mockResolvedValueOnce({
      text: JSON.stringify({ ok: true }),
      usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 8 },
    });
    const res = await googleAdapter.generateStructured({
      apiKey: "k",
      system: "s",
      user: "u",
      schema: SCHEMA,
    });
    expect(res.data).toEqual({ ok: true });
    expect(res.usage).toEqual({ inputTokens: 7, outputTokens: 8 });
    const call = googleGenerate.mock.calls[0][0];
    expect(call.contents[0].parts[0].text).toContain(JSON.stringify(SCHEMA));
  });
});

describe("supportsTools", () => {
  it("is true for anthropic and false for openai/google", () => {
    expect(anthropicAdapter.supportsTools).toBe(true);
    expect(openaiAdapter.supportsTools).toBe(false);
    expect(googleAdapter.supportsTools).toBe(false);
  });
});
