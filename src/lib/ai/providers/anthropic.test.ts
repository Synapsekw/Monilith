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
    expect(
      (captured[0].output_config as Record<string, unknown>).effort,
    ).toBeUndefined();
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
