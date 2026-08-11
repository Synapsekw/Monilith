import { describe, expect, it, vi } from "vitest";
import { generateItemAssist } from "@/lib/ai/item-assist/assist";

type ParseParams = {
  model: string;
  max_tokens: number;
  output_config: { effort: string; format: unknown };
  system: { type: string; text: string }[];
  messages: { role: string; content: unknown }[];
};

/** A fake Anthropic client whose `messages.parse` returns a canned response
 *  and records the request params — mirrors ask.test.ts's fakeClient, but
 *  for the structured-output `.parse()` call generateItemAssist uses. */
function fakeClient(response: unknown) {
  const calls: ParseParams[] = [];
  const parse = vi.fn(async (params: ParseParams) => {
    calls.push(params);
    return response;
  });
  return { calls, parse, client: { messages: { parse } } };
}

describe("generateItemAssist", () => {
  it("maps a parsed_output description proposal and usage, with no network call beyond the fake client", async () => {
    const { client, calls, parse } = fakeClient({
      parsed_output: { description: "A drafted description." },
      content: [],
      usage: { input_tokens: 123, output_tokens: 45 },
    });

    const res = await generateItemAssist({
      apiKey: "k",
      model: "claude-haiku-4-5",
      item: { name: "Fix login bug", textContext: "users can't log in" },
      want: { description: { columnId: "col-desc" } },
      client: client as never,
    });

    expect(res.proposal).toEqual({ description: "A drafted description." });
    expect(res.usage).toEqual({
      inputTokens: 123,
      outputTokens: 45,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
    expect(parse).toHaveBeenCalledTimes(1); // exactly one call, no retries/network

    const call = calls[0];
    expect(call.messages[0].content).toContain("Fix login bug");
    expect(call.messages[0].content).toContain("users can't log in");
  });

  it("requests only the fields in `want` and maps subtasks + status", async () => {
    const { client } = fakeClient({
      parsed_output: {
        subtasks: ["Reproduce the bug", "Write a regression test"],
        status: { optionId: "opt-done" },
      },
      content: [],
      usage: { input_tokens: 10, output_tokens: 5 },
    });

    const res = await generateItemAssist({
      apiKey: "k",
      model: "claude-haiku-4-5",
      item: { name: "Ship feature" },
      statusOptions: [
        { id: "opt-todo", label: "To do" },
        { id: "opt-done", label: "Done" },
      ],
      want: { subtasks: true, status: { columnId: "col-status" } },
      client: client as never,
    });

    expect(res.proposal).toEqual({
      subtasks: ["Reproduce the bug", "Write a regression test"],
      status: { columnId: "col-status", optionId: "opt-done" },
    });
  });

  it("falls back to JSON.parse of the text block when parsed_output is absent", async () => {
    const { client } = fakeClient({
      content: [{ type: "text", text: '{"description":"from text block"}' }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    const res = await generateItemAssist({
      apiKey: "k",
      model: "claude-haiku-4-5",
      item: { name: "Item" },
      want: { description: { columnId: "col-desc" } },
      client: client as never,
    });

    expect(res.proposal).toEqual({ description: "from text block" });
  });

  it("assists on haiku with the enabled-thinking shape and no effort", async () => {
    const captured: Record<string, unknown>[] = [];
    const client = {
      messages: {
        parse: async (params: Record<string, unknown>) => {
          captured.push(params);
          return {
            content: [{ type: "text", text: "{}" }],
            parsed_output: { description: "d" },
            usage: {
              input_tokens: 20,
              output_tokens: 8,
              cache_read_input_tokens: 0,
              cache_creation_input_tokens: 0,
            },
          };
        },
      },
    } as never;

    const { usage } = await generateItemAssist({
      apiKey: "sk-ant-test",
      model: "claude-haiku-4-5",
      item: { name: "Ship billing" },
      want: { description: { columnId: "col-desc" } },
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
    expect(usage.cacheWriteTokens).toBe(0);
  });
});
