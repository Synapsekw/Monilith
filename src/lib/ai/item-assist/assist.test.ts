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
      item: { name: "Fix login bug", textContext: "users can't log in" },
      want: { description: { columnId: "col-desc" } },
      client: client as never,
    });

    expect(res.proposal).toEqual({ description: "A drafted description." });
    expect(res.usage).toEqual({ inputTokens: 123, outputTokens: 45 });
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
      item: { name: "Item" },
      want: { description: { columnId: "col-desc" } },
      client: client as never,
    });

    expect(res.proposal).toEqual({ description: "from text block" });
  });
});
