import { describe, expect, it, vi, beforeEach } from "vitest";
import { ProviderAuthError } from "@/lib/ai/providers/types";

// --- Anthropic SDK stub (validateKey only — generation runs on the AI SDK) ---
const anthropicList = vi.fn();
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
    constructor(readonly opts: { apiKey: string }) {}
  }
  return { default: Anthropic };
});

// --- OpenAI SDK stub ---
const openaiList = vi.fn();
// Same TDZ hazard as AnthropicAuthError above — hoist via vi.hoisted().
const OpenAIAuthError = vi.hoisted(() => class extends Error {});
vi.mock("openai", () => {
  class OpenAI {
    static AuthenticationError = OpenAIAuthError;
    models = { list: (...a: unknown[]) => openaiList(...a) };
    constructor(readonly opts: { apiKey: string }) {}
  }
  return { default: OpenAI };
});

// --- Google GenAI stub ---
const googleList = vi.fn();
vi.mock("@google/genai", () => {
  class GoogleGenAI {
    models = { list: (...a: unknown[]) => googleList(...a) };
    constructor(readonly opts: { apiKey: string }) {}
  }
  return { GoogleGenAI };
});

import { anthropicAdapter } from "@/lib/ai/providers/anthropic";
import { openaiAdapter } from "@/lib/ai/providers/openai";
import { googleAdapter } from "@/lib/ai/providers/google";
import { openaiCompatibleAdapter } from "@/lib/ai/providers/openai-compatible";
import { getAdapter } from "@/lib/ai/providers/registry";
import { ADAPTER_KINDS } from "@/lib/ai/providers/provider-rows";
import { fakeGenerateObject, type CapturedCall } from "@/test/adapter-fakes";

const PROPOSAL = { name: "X", widgets: [] };
const SCHEMA = { type: "object", properties: { ok: { type: "boolean" } } };

/** Only the openai-compatible adapter is allowed to need a baseUrl. */
function baseUrlFor(kind: string): string | null {
  return kind === "openai-compatible" ? "https://api.moonshot.ai/v1" : null;
}

beforeEach(() => {
  [anthropicList, openaiList, googleList].forEach((m) => m.mockReset());
});

describe("registry", () => {
  it("maps each adapter KIND — not provider id — to its adapter", () => {
    expect(getAdapter("anthropic")).toBe(anthropicAdapter);
    expect(getAdapter("openai")).toBe(openaiAdapter);
    expect(getAdapter("google")).toBe(googleAdapter);
    expect(getAdapter("openai-compatible")).toBe(openaiCompatibleAdapter);
  });

  it("covers every kind the provider registry can store", () => {
    // A row with an adapter_kind the registry cannot serve would resolve to
    // undefined and blow up at the call site instead of here.
    for (const kind of ADAPTER_KINDS) {
      expect(getAdapter(kind).kind).toBe(kind);
    }
  });
});

describe("validateKey", () => {
  it("anthropic: resolves on success, throws ProviderAuthError on 401", async () => {
    anthropicList.mockResolvedValueOnce({});
    await expect(
      anthropicAdapter.validateKey({ apiKey: "sk-ant-ok", baseUrl: null }),
    ).resolves.toBeUndefined();
    anthropicList.mockRejectedValueOnce(new AnthropicAuthError("bad"));
    await expect(
      anthropicAdapter.validateKey({ apiKey: "sk-ant-bad", baseUrl: null }),
    ).rejects.toBeInstanceOf(ProviderAuthError);
  });

  it("openai: throws ProviderAuthError on 401", async () => {
    openaiList.mockRejectedValueOnce(new OpenAIAuthError("bad"));
    await expect(
      openaiAdapter.validateKey({ apiKey: "sk-bad", baseUrl: null }),
    ).rejects.toBeInstanceOf(ProviderAuthError);
  });

  it("google: throws ProviderAuthError when the list call fails", async () => {
    googleList.mockImplementationOnce(() => {
      throw new Error("API key not valid");
    });
    await expect(
      googleAdapter.validateKey({ apiKey: "AIza-bad", baseUrl: null }),
    ).rejects.toBeInstanceOf(ProviderAuthError);
  });

  it("anthropic: propagates a non-auth error unmapped", async () => {
    anthropicList.mockRejectedValueOnce(new Error("network down"));
    const p = anthropicAdapter.validateKey({
      apiKey: "sk-ant-ok",
      baseUrl: null,
    });
    await expect(p).rejects.toThrow("network down");
    await expect(p).rejects.not.toBeInstanceOf(ProviderAuthError);
  });

  it("openai: propagates a non-auth error unmapped", async () => {
    openaiList.mockRejectedValueOnce(new Error("network down"));
    const p = openaiAdapter.validateKey({ apiKey: "sk-ok", baseUrl: null });
    await expect(p).rejects.toThrow("network down");
    await expect(p).rejects.not.toBeInstanceOf(ProviderAuthError);
  });
});

// THE regression this layer exists to close. Before it, the OpenAI and Google
// adapters ignored the requested model and ran a module-level constant
// (`gpt-4o` / `gemini-2.0-flash`) — so `model-map` could emit whatever it liked
// and a BYO org was metered against a model that never ran.
describe("every adapter honours the requested model", () => {
  it.each(ADAPTER_KINDS)(
    "%s dispatches args.model and reports it back",
    async (kind) => {
      const captured: CapturedCall[] = [];
      const res = await getAdapter(kind).generateStructured({
        apiKey: "k",
        baseUrl: baseUrlFor(kind),
        model: "some-specific-model",
        system: "s",
        user: "u",
        schema: SCHEMA,
        client: { generateObject: fakeGenerateObject(captured) },
      });
      // `model` here is the REAL LanguageModel the provider factory built, so
      // this asserts the string reached the SDK — not that we echoed it.
      expect(captured[0].model.modelId).toBe("some-specific-model");
      expect(res.model).toBe("some-specific-model");
    },
  );

  it.each(ADAPTER_KINDS)(
    "%s carries it through generateProposal",
    async (kind) => {
      const captured: CapturedCall[] = [];
      const res = await getAdapter(kind).generateProposal({
        apiKey: "k",
        baseUrl: baseUrlFor(kind),
        model: "another-model",
        system: "s",
        user: "u",
        client: {
          generateObject: fakeGenerateObject(captured, { object: PROPOSAL }),
        },
      });
      expect(captured[0].model.modelId).toBe("another-model");
      expect(res.model).toBe("another-model");
      expect(res.proposal.name).toBe("X");
    },
  );

  it.each(ADAPTER_KINDS)("%s sends the caller's schema", async (kind) => {
    const captured: CapturedCall[] = [];
    await getAdapter(kind).generateStructured({
      apiKey: "k",
      baseUrl: baseUrlFor(kind),
      model: "m",
      system: "s",
      user: "u",
      schema: SCHEMA,
      client: { generateObject: fakeGenerateObject(captured) },
    });
    expect((captured[0].schema as { jsonSchema: unknown }).jsonSchema).toEqual(
      SCHEMA,
    );
  });
});

describe("usage is metered from the provider response", () => {
  it.each(ADAPTER_KINDS)(
    "%s reports uncached input separately",
    async (kind) => {
      const res = await getAdapter(kind).generateStructured({
        apiKey: "k",
        baseUrl: baseUrlFor(kind),
        model: "m",
        system: "s",
        user: "u",
        schema: SCHEMA,
        client: {
          generateObject: fakeGenerateObject([], {
            usage: {
              // The SDK's `inputTokens` is the cache-INCLUSIVE total.
              inputTokens: 1100,
              outputTokens: 340,
              inputTokenDetails: {
                noCacheTokens: 200,
                cacheReadTokens: 800,
                cacheWriteTokens: 100,
              },
            },
          }),
        },
      });
      expect(res.usage).toEqual({
        inputTokens: 200,
        outputTokens: 340,
        cacheReadTokens: 800,
        cacheWriteTokens: 100,
      });
    },
  );
});
