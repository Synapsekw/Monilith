import { describe, expect, it } from "vitest";
import { openaiCompatibleAdapter } from "@/lib/ai/providers/openai-compatible";
import { fakeGenerateObject, type CapturedCall } from "@/test/adapter-fakes";

const SCHEMA = { type: "object", properties: { ok: { type: "boolean" } } };

function args(over: Partial<Parameters<typeof base>[0]> = {}) {
  return { ...base({}), ...over };
}
function base(over: {
  apiKey?: string;
  baseUrl?: string | null;
  model?: string;
}) {
  return {
    apiKey: "sk-test",
    baseUrl: "https://api.moonshot.ai/v1" as string | null,
    model: "kimi-k2",
    system: "s",
    user: "u",
    schema: SCHEMA,
    ...over,
  };
}

describe("openaiCompatibleAdapter", () => {
  it("sends the REQUESTED model, not a hardcoded default", async () => {
    const captured: CapturedCall[] = [];
    const res = await openaiCompatibleAdapter.generateStructured({
      ...args(),
      client: { generateObject: fakeGenerateObject(captured) },
    });
    expect(captured[0].model.modelId).toBe("kimi-k2");
    // The reported model must be what actually ran — metering reads this.
    expect(res.model).toBe("kimi-k2");
  });

  it("serves a DIFFERENT provider on the same adapter, keyed only by baseUrl", async () => {
    // Mistral and Kimi share this one adapter; nothing but the baseUrl and the
    // model id distinguishes them, which is what lets a provider be added to
    // `ai_providers` with no deploy.
    const captured: CapturedCall[] = [];
    await openaiCompatibleAdapter.generateStructured({
      ...args({ baseUrl: "https://api.mistral.ai/v1", model: "mistral-large" }),
      client: { generateObject: fakeGenerateObject(captured) },
    });
    expect(captured[0].model.modelId).toBe("mistral-large");
  });

  it("reports usage from the provider response", async () => {
    const res = await openaiCompatibleAdapter.generateStructured({
      ...args(),
      client: {
        generateObject: fakeGenerateObject([], {
          usage: {
            inputTokens: 11,
            outputTokens: 7,
            inputTokenDetails: { noCacheTokens: 11 },
          },
        }),
      },
    });
    expect(res.usage.inputTokens).toBe(11);
    expect(res.usage.outputTokens).toBe(7);
  });

  it("refuses to run without a baseUrl", async () => {
    // A null baseUrl means the ai_providers row is malformed. Failing here is
    // far better than defaulting to api.openai.com and posting the customer's
    // Kimi key to OpenAI.
    await expect(
      openaiCompatibleAdapter.generateStructured({
        ...args({ baseUrl: null }),
      }),
    ).rejects.toThrow(/baseUrl/);
  });

  it("refuses to validate a key without a baseUrl", async () => {
    await expect(
      openaiCompatibleAdapter.validateKey({ apiKey: "sk-test", baseUrl: null }),
    ).rejects.toThrow(/baseUrl/);
  });

  it("actually posts to the row's baseUrl", async () => {
    // The one test that runs the REAL generateObject: only the transport is
    // faked, so the request URL and body are the SDK's own, not ours.
    const calls: { url: string; body: unknown }[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(input),
        body: JSON.parse(String(init?.body ?? "{}")),
      });
      return new Response(
        JSON.stringify({
          id: "cmpl-1",
          created: 0,
          model: "kimi-k2",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: { role: "assistant", content: '{"ok":true}' },
            },
          ],
          usage: { prompt_tokens: 11, completion_tokens: 7 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof globalThis.fetch;

    const res = await openaiCompatibleAdapter.generateStructured({
      ...args(),
      client: { fetch: fetchImpl },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.moonshot.ai/v1/chat/completions");
    const body = calls[0].body as {
      model: string;
      response_format?: { type: string; json_schema?: { schema: unknown } };
    };
    expect(body.model).toBe("kimi-k2");
    // The SDK drops the schema (with a warning only) unless the provider is
    // declared structured-output capable — a structured-output adapter that
    // silently sends no schema is the failure this pins down.
    expect(body.response_format?.type).toBe("json_schema");
    expect(body.response_format?.json_schema?.schema).toEqual(SCHEMA);
    expect(res.data).toEqual({ ok: true });
    expect(res.usage).toEqual({
      inputTokens: 11,
      outputTokens: 7,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
  });
});
