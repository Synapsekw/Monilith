import { describe, expect, it, vi } from "vitest";
import { anthropicAdapter } from "@/lib/ai/providers/anthropic";
import { modelFor } from "@/lib/ai/model-map";

function fakeClient(captured: Record<string, unknown>[]) {
  return {
    messages: {
      parse: vi.fn(async (params: Record<string, unknown>) => {
        captured.push(params);
        return {
          content: [{ type: "text", text: "{}" }],
          parsed_output: {},
          usage: {
            input_tokens: 10,
            output_tokens: 5,
            cache_read_input_tokens: 900,
            cache_creation_input_tokens: 100,
          },
        };
      }),
    },
  } as never;
}

describe("anthropicAdapter.generateStructured", () => {
  it("sends the haiku request shape with no effort key", async () => {
    const captured: Record<string, unknown>[] = [];
    await anthropicAdapter.generateStructured({
      apiKey: "sk-ant-test",
      system: "s",
      user: "u",
      schema: { type: "object" },
      choice: modelFor("item_assist"),
      client: fakeClient(captured),
    });
    expect(captured[0].model).toBe("claude-haiku-4-5");
    expect(captured[0].thinking).toEqual({
      type: "enabled",
      budget_tokens: 1024,
    });
    // The key must be ABSENT, not present-and-undefined: the SDK serializes an
    // explicit `effort: undefined` and Haiku 4.5 rejects the field. A
    // `toBeUndefined()` assertion passes in both cases and so cannot see the
    // regression it exists to catch.
    const outputConfig = captured[0].output_config as Record<string, unknown>;
    expect("effort" in outputConfig).toBe(false);
  });

  it("sends the sonnet request shape with effort", async () => {
    const captured: Record<string, unknown>[] = [];
    await anthropicAdapter.generateStructured({
      apiKey: "sk-ant-test",
      system: "s",
      user: "u",
      schema: { type: "object" },
      choice: modelFor("dashboard_gen"),
      client: fakeClient(captured),
    });
    expect(captured[0].model).toBe("claude-sonnet-5");
    expect((captured[0].output_config as Record<string, unknown>).effort).toBe(
      "high",
    );
  });

  it("reports the model it actually ran, so runAi meters the right rate", async () => {
    const { model } = await anthropicAdapter.generateStructured({
      apiKey: "sk-ant-test",
      system: "s",
      user: "u",
      schema: { type: "object" },
      choice: modelFor("item_assist"),
      client: fakeClient([]),
    });
    // This adapter DOES honour `choice`, so the reported model follows it.
    expect(model).toBe("claude-haiku-4-5");
  });

  it("reports cache tokens in usage", async () => {
    const { usage } = await anthropicAdapter.generateStructured({
      apiKey: "sk-ant-test",
      system: "s",
      user: "u",
      schema: { type: "object" },
      client: fakeClient([]),
    });
    expect(usage.cacheReadTokens).toBe(900);
    expect(usage.cacheWriteTokens).toBe(100);
  });
});
