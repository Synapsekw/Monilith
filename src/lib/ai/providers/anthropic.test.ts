import { describe, expect, it } from "vitest";
import { anthropicAdapter } from "@/lib/ai/providers/anthropic";
import { toRequestArgs } from "@/lib/ai/providers/request";
import { fakeGenerateObject, type CapturedCall } from "@/test/adapter-fakes";

/** Exactly what a runAi caller hands the adapter for one resolved model. */
function argsFor(model: string) {
  return {
    ...toRequestArgs({ apiKey: "sk-ant-test", model }),
    system: "s",
    user: "u",
    schema: { type: "object" },
  };
}

function anthropicOptions(call: CapturedCall) {
  return (call.providerOptions?.anthropic ?? {}) as Record<string, unknown>;
}

describe("anthropicAdapter.generateStructured request shape", () => {
  it("sends the haiku model with the enabled-thinking shape and no effort key", async () => {
    const captured: CapturedCall[] = [];
    await anthropicAdapter.generateStructured({
      ...argsFor("claude-haiku-4-5"),
      client: { generateObject: fakeGenerateObject(captured) },
    });
    expect(captured[0].model.modelId).toBe("claude-haiku-4-5");
    // camelCase `budgetTokens`, NOT the raw wire `budget_tokens`: the AI SDK
    // parses providerOptions with a zod schema that STRIPS unknown keys, so
    // the snake_case form would silently send a thinking block with no budget.
    expect(anthropicOptions(captured[0]).thinking).toEqual({
      type: "enabled",
      budgetTokens: 1024,
    });
    // The key must be ABSENT, not present-and-undefined: Haiku 4.5 rejects the
    // field, and a `toBeUndefined()` assertion passes in both cases and so
    // cannot see the regression it exists to catch.
    expect("effort" in anthropicOptions(captured[0])).toBe(false);
  });

  it("sends the sonnet model with adaptive thinking and effort", async () => {
    const captured: CapturedCall[] = [];
    await anthropicAdapter.generateStructured({
      ...argsFor("claude-sonnet-5"),
      client: { generateObject: fakeGenerateObject(captured) },
    });
    expect(captured[0].model.modelId).toBe("claude-sonnet-5");
    expect(anthropicOptions(captured[0]).thinking).toEqual({
      type: "adaptive",
    });
    expect(anthropicOptions(captured[0]).effort).toBe("high");
  });

  it("marks the system prompt as an ephemeral cache breakpoint", async () => {
    // The system prompt is frozen per feature and is the prompt-cache prefix.
    // It is sent as a system MESSAGE precisely because cache_control can only
    // be attached via providerOptions — losing it multiplies input COGS with
    // no visible failure. It rides `instructions`: ai@7 refuses a system role
    // inside `messages` (see the real-generateObject test below).
    const captured: CapturedCall[] = [];
    await anthropicAdapter.generateStructured({
      ...argsFor("claude-sonnet-5"),
      client: { generateObject: fakeGenerateObject(captured) },
    });
    const instructions = captured[0].instructions;
    expect(Array.isArray(instructions)).toBe(true);
    const system = Array.isArray(instructions) ? instructions[0] : undefined;
    expect(system?.role).toBe("system");
    expect(system?.content).toBe("s");
    expect(system?.providerOptions?.anthropic).toEqual({
      cacheControl: { type: "ephemeral" },
    });
    expect(captured[0].messages).toHaveLength(1);
    expect(captured[0].messages?.[0]).toMatchObject({
      role: "user",
      content: "u",
    });
  });

  it("bounds the output length", async () => {
    const captured: CapturedCall[] = [];
    await anthropicAdapter.generateStructured({
      ...argsFor("claude-sonnet-5"),
      client: { generateObject: fakeGenerateObject(captured) },
    });
    expect(captured[0].maxOutputTokens).toBe(16000);
  });

  it("reports the model it actually ran, so runAi meters the right rate", async () => {
    const { model } = await anthropicAdapter.generateStructured({
      ...argsFor("claude-haiku-4-5"),
      client: { generateObject: fakeGenerateObject([]) },
    });
    expect(model).toBe("claude-haiku-4-5");
  });

  it("reports cache tokens in usage", async () => {
    const { usage } = await anthropicAdapter.generateStructured({
      ...argsFor("claude-sonnet-5"),
      client: {
        generateObject: fakeGenerateObject([], {
          usage: {
            inputTokens: 1010,
            outputTokens: 5,
            inputTokenDetails: {
              noCacheTokens: 10,
              cacheReadTokens: 900,
              cacheWriteTokens: 100,
            },
          },
        }),
      },
    });
    expect(usage).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 900,
      cacheWriteTokens: 100,
    });
  });
});

describe("anthropicAdapter.generateStructured through the REAL generateObject", () => {
  // Regression: ai@7.0.92 rejects a role:"system" entry inside `messages`
  // (`allowSystemInMessages` defaults false — "Use the instructions option
  // instead"). The fake-generateObject tests above cannot see that guard, so
  // this one runs the SDK for real and fakes only the transport. Every
  // Anthropic-routed structured feature 500'd on it in production.
  it("reaches the wire with the system prompt as a cache-controlled system block", async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<
        string,
        unknown
      >;
      calls.push({ url: String(input), body });
      // Answer in whichever shape the SDK asked for: a tool call when it
      // registered a tool, plain JSON text otherwise.
      const tools = body.tools as { name: string }[] | undefined;
      const content = tools?.length
        ? [
            {
              type: "tool_use",
              id: "toolu_1",
              name: tools[0].name,
              input: { ok: true },
            },
          ]
        : [{ type: "text", text: '{"ok":true}' }];
      return new Response(
        JSON.stringify({
          id: "msg_1",
          type: "message",
          role: "assistant",
          model: "claude-haiku-4-5",
          content,
          stop_reason: tools?.length ? "tool_use" : "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 11, output_tokens: 7 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof globalThis.fetch;

    const res = await anthropicAdapter.generateStructured({
      ...argsFor("claude-haiku-4-5"),
      client: { fetch: fetchImpl },
    });

    expect(calls).toHaveLength(1);
    const body = calls[0].body;
    // The system prompt travels as Anthropic's top-level `system` blocks with
    // the ephemeral cache breakpoint — the whole reason it is a message-shaped
    // instruction rather than a bare string.
    expect(body.system).toEqual([
      { type: "text", text: "s", cache_control: { type: "ephemeral" } },
    ]);
    expect(body.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "u" }] },
    ]);
    expect(res.data).toEqual({ ok: true });
    expect(res.usage).toMatchObject({ inputTokens: 11, outputTokens: 7 });
  });
});
