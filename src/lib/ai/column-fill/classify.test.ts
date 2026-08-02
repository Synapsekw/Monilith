import { describe, expect, it, vi } from "vitest";
import { classifyColumn } from "@/lib/ai/column-fill/classify";
import type { ClassifyRow, TargetOption } from "@/lib/ai/column-fill/schema";

type ParseParams = {
  model: string;
  max_tokens: number;
  system: { type: string; text: string; cache_control?: unknown }[];
  messages: { role: string; content: unknown }[];
};

/** A fake Anthropic client whose `messages.parse` resolves to a scripted
 *  response and records the request params for inspection. Mirrors the DI
 *  pattern in src/lib/ai/ask/ask.test.ts — zero network calls. */
function fakeClient(response: unknown) {
  const parse = vi.fn(async (params: ParseParams) => {
    calls.push(params);
    return response;
  });
  const calls: ParseParams[] = [];
  return { calls, parse, client: { messages: { parse } } };
}

const ROWS: ClassifyRow[] = [
  { itemId: "item-1", text: "In Progress" },
  { itemId: "item-2", text: "not sure" },
];
const TARGET_OPTIONS: TargetOption[] = [
  { id: "opt-1", label: "In Progress" },
  { id: "opt-2", label: "Done" },
];

describe("classifyColumn", () => {
  it("maps rows to option ids from the injected client's parsed_output, making no network call", async () => {
    const { client, parse } = fakeClient({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            rows: [
              { itemId: "item-1", optionId: "opt-1" },
              { itemId: "item-2", optionId: null },
            ],
          }),
        },
      ],
      parsed_output: {
        rows: [
          { itemId: "item-1", optionId: "opt-1" },
          { itemId: "item-2", optionId: null },
        ],
      },
      usage: { input_tokens: 123, output_tokens: 45 },
    });

    const res = await classifyColumn({
      apiKey: "sk-ant-test",
      rows: ROWS,
      targetOptions: TARGET_OPTIONS,
      client: client as never,
    });

    expect(res.classifications).toEqual([
      { itemId: "item-1", optionId: "opt-1" },
      { itemId: "item-2", optionId: null },
    ]);
    expect(res.usage).toEqual({
      inputTokens: 123,
      outputTokens: 45,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });

    // Exactly one call, and it never hit the network (fake client only).
    expect(parse).toHaveBeenCalledTimes(1);
    const call = parse.mock.calls[0][0] as ParseParams;
    expect(call.system[0].text).toEqual(expect.any(String));
    // The rows + target options are handed to the model as JSON in the user turn.
    const userContent = call.messages[0].content as string;
    expect(userContent).toContain("item-1");
    expect(userContent).toContain("opt-1");
  });

  it("falls back to parsing the text block when parsed_output is absent", async () => {
    const { client } = fakeClient({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            rows: [{ itemId: "item-1", optionId: "opt-1" }],
          }),
        },
      ],
      usage: { input_tokens: 10, output_tokens: 5 },
    });

    const res = await classifyColumn({
      apiKey: "sk-ant-test",
      rows: [ROWS[0]],
      targetOptions: TARGET_OPTIONS,
      client: client as never,
    });

    expect(res.classifications).toEqual([
      { itemId: "item-1", optionId: "opt-1" },
    ]);
  });

  it("classifies on haiku with the enabled-thinking shape and no effort", async () => {
    const captured: Record<string, unknown>[] = [];
    const client = {
      messages: {
        parse: async (params: Record<string, unknown>) => {
          captured.push(params);
          return {
            content: [{ type: "text", text: '{"rows":[]}' }],
            parsed_output: { rows: [] },
            usage: {
              input_tokens: 10,
              output_tokens: 2,
              cache_read_input_tokens: 0,
              cache_creation_input_tokens: 0,
            },
          };
        },
      },
    } as never;

    const { usage } = await classifyColumn({
      apiKey: "sk-ant-test",
      rows: [],
      targetOptions: [],
      client,
    });

    expect(captured[0].model).toBe("claude-haiku-4-5");
    expect(captured[0].thinking).toEqual({
      type: "enabled",
      budget_tokens: 1024,
    });
    expect(
      (captured[0].output_config as Record<string, unknown>).effort,
    ).toBeUndefined();
    expect(usage.cacheReadTokens).toBe(0);
  });
});
