import { describe, expect, it } from "vitest";
import { anthropicAdapter } from "@/lib/ai/providers/anthropic";
import { toRequestArgs } from "@/lib/ai/providers/request";
import { modelFor } from "@/lib/ai/model-map";
import { fakeGenerateObject, type CapturedCall } from "@/test/adapter-fakes";

/** Exactly what a runAi caller hands the adapter for one feature. */
function argsFor(feature: string) {
  return {
    ...toRequestArgs({ apiKey: "sk-ant-test", choice: modelFor(feature) }),
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
      ...argsFor("item_assist"),
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
      ...argsFor("dashboard_gen"),
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
    // no visible failure.
    const captured: CapturedCall[] = [];
    await anthropicAdapter.generateStructured({
      ...argsFor("dashboard_gen"),
      client: { generateObject: fakeGenerateObject(captured) },
    });
    const system = captured[0].messages?.[0];
    expect(system?.role).toBe("system");
    expect(system?.content).toBe("s");
    expect(system?.providerOptions?.anthropic).toEqual({
      cacheControl: { type: "ephemeral" },
    });
    expect(captured[0].messages?.[1]).toMatchObject({
      role: "user",
      content: "u",
    });
  });

  it("bounds the output length", async () => {
    const captured: CapturedCall[] = [];
    await anthropicAdapter.generateStructured({
      ...argsFor("dashboard_gen"),
      client: { generateObject: fakeGenerateObject(captured) },
    });
    expect(captured[0].maxOutputTokens).toBe(16000);
  });

  it("reports the model it actually ran, so runAi meters the right rate", async () => {
    const { model } = await anthropicAdapter.generateStructured({
      ...argsFor("item_assist"),
      client: { generateObject: fakeGenerateObject([]) },
    });
    expect(model).toBe("claude-haiku-4-5");
  });

  it("reports cache tokens in usage", async () => {
    const { usage } = await anthropicAdapter.generateStructured({
      ...argsFor("dashboard_gen"),
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
