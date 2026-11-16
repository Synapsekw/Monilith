import { describe, it, expect, vi } from "vitest";
import * as z from "zod";
import { simulateReadableStream, tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { ALL_TOOL_DESCRIPTORS } from "@/lib/mcp/tools/catalog";
import {
  ASSISTANT_MAX_OUTPUT_TOKENS,
  ASSISTANT_MAX_STEPS,
  ASSISTANT_PREAMBLE,
  runAssistantLoop,
  type AssistantEvent,
} from "./runtime";
import { ASSISTANT_COMMENT_MAX_CHARS } from "./unsupported";

const usage = {
  inputTokens: { total: 30, noCache: 10, cacheRead: 20, cacheWrite: 0 },
  outputTokens: { total: 20, text: 20, reasoning: undefined },
};
const finish = (unified: "stop" | "tool-calls") => ({
  type: "finish" as const,
  finishReason: { unified, raw: undefined },
  logprobs: undefined,
  usage,
});
const textChunks = (text: string) => [
  { type: "text-start" as const, id: "t" },
  { type: "text-delta" as const, id: "t", delta: text },
  { type: "text-end" as const, id: "t" },
  finish("stop"),
];
const callChunks = (toolName: string, input: object, id = "c1") => [
  {
    type: "tool-call" as const,
    toolCallId: id,
    toolName,
    input: JSON.stringify(input),
  },
  finish("tool-calls"),
];

/** A model that plays one scripted chunk list per step. */
function scripted(steps: unknown[][]) {
  let i = 0;
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: (steps[Math.min(i++, steps.length - 1)] ?? []) as never[],
      }),
    }),
  });
}

const messages = [{ role: "user" as const, content: "hi" }];

describe("ASSISTANT_PREAMBLE tool references", () => {
  it("names only tools that exist in the catalog", () => {
    const names = new Set(ALL_TOOL_DESCRIPTORS.map((d) => d.name));
    const mentioned =
      ASSISTANT_PREAMBLE.match(
        /\b(?:get|list|query|search|manage|create|update)_[a-z_]+\b/g,
      ) ?? [];
    expect(mentioned.length).toBeGreaterThan(0);
    for (const m of mentioned) expect(names.has(m), m).toBe(true);
  });

  it("routes focus, filtered and why questions to their tools", () => {
    expect(ASSISTANT_PREAMBLE).toContain("get_focus_today");
    expect(ASSISTANT_PREAMBLE).toContain("query_items");
    expect(ASSISTANT_PREAMBLE).toContain("get_item_thread");
  });

  it("says where folder ids and user ids come from, and how to comment", () => {
    const names = new Set(ALL_TOOL_DESCRIPTORS.map((d) => d.name));
    for (const tool of ["list_folders", "list_people", "add_comment"]) {
      expect(names.has(tool), tool).toBe(true);
      expect(ASSISTANT_PREAMBLE).toContain(tool);
    }
    expect(ASSISTANT_PREAMBLE).toMatch(/never guess a user id/);
    // The preamble's comment length is the limit staging enforces.
    expect(ASSISTANT_PREAMBLE).toContain(
      `at most ${ASSISTANT_COMMENT_MAX_CHARS} characters`,
    );
  });

  it("calls get_focus_today with no arguments unless a known folder is named (live-run defect A)", () => {
    const line = ASSISTANT_PREAMBLE.split("\n").find((l) =>
      l.includes("call get_focus_today"),
    );
    expect(line).toMatch(/with no arguments/);
    expect(line).toMatch(/folderId/);
    expect(line).toMatch(/never invent/i);
    const tool = ALL_TOOL_DESCRIPTORS.find((d) => d.name === "get_focus_today");
    expect(Object.keys(tool!.inputSchema)).toContain("folderId");
  });

  it("says query_items takes a person's name as assignee (review I4)", () => {
    const line = ASSISTANT_PREAMBLE.split("\n").find((l) =>
      l.includes("call query_items"),
    );
    expect(line).toMatch(/assignee/);
    expect(line).toMatch(/person's name/);
    // The parameter named in the prompt exists on the tool.
    const tool = ALL_TOOL_DESCRIPTORS.find((d) => d.name === "query_items");
    expect(Object.keys(tool!.inputSchema)).toContain("assignee");
  });
});

describe("runAssistantLoop", () => {
  it("streams text as token events and returns it", async () => {
    const events: AssistantEvent[] = [];
    const r = await runAssistantLoop({
      model: scripted([textChunks("Hello")]),
      system: "s",
      messages,
      tools: {},
      emit: (e) => events.push(e),
    });
    expect(r.text).toBe("Hello");
    expect(events).toContainEqual({ type: "token", text: "Hello" });
    expect(r.steps).toBe(1);
    expect(r.hitStepCap).toBe(false);
    expect(r.wroteText).toBe(true);
  });

  it("reports wroteText false and keeps the fallback when the model writes only whitespace", async () => {
    const r = await runAssistantLoop({
      model: scripted([textChunks("  \n ")]),
      system: "s",
      messages,
      tools: {},
      emit: () => {},
    });
    expect(r.wroteText).toBe(false);
    expect(r.text).toContain("I finished without writing an answer.");
  });

  it("runs a tool, feeds the result back, and reports the tool as used", async () => {
    const execute = vi.fn(async () => "3 items");
    const r = await runAssistantLoop({
      model: scripted([
        callChunks("list_items", { boardId: "b" }),
        textChunks("Three."),
      ]),
      system: "s",
      messages,
      tools: {
        list_items: tool({
          inputSchema: z.object({ boardId: z.string() }),
          execute,
        }),
      },
      emit: () => {},
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(r.text).toBe("Three.");
    expect(r.toolsUsed).toEqual(["list_items"]);
    expect(r.steps).toBe(2);
  });

  it("does not list a tool whose result was an error", async () => {
    const r = await runAssistantLoop({
      model: scripted([
        callChunks("list_items", { boardId: "b" }),
        textChunks("Sorry."),
      ]),
      system: "s",
      messages,
      tools: {
        list_items: tool({
          inputSchema: z.object({ boardId: z.string() }),
          execute: async () => ({ error: "Board not found." }),
        }),
      },
      emit: () => {},
    });
    expect(r.toolsUsed).toEqual([]);
  });

  it("stops at the step cap and says so when the model never writes text", async () => {
    const r = await runAssistantLoop({
      model: scripted([callChunks("list_items", { boardId: "b" })]),
      system: "s",
      messages,
      tools: {
        list_items: tool({
          inputSchema: z.object({ boardId: z.string() }),
          execute: async () => "x",
        }),
      },
      emit: () => {},
    });
    expect(r.steps).toBe(ASSISTANT_MAX_STEPS);
    expect(r.hitStepCap).toBe(true);
    expect(r.wroteText).toBe(false);
    expect(r.text).toContain("step limit");
  });

  it("reports running usage after each step and a cache-aware total", async () => {
    const onUsage = vi.fn();
    const r = await runAssistantLoop({
      model: scripted([
        callChunks("list_items", { boardId: "b" }),
        textChunks("ok"),
      ]),
      system: "s",
      messages,
      tools: {
        list_items: tool({
          inputSchema: z.object({ boardId: z.string() }),
          execute: async () => "x",
        }),
      },
      emit: () => {},
      onUsage,
    });
    expect(onUsage).toHaveBeenCalledTimes(2);
    expect(r.usage.outputTokens).toBe(40);
    expect(r.usage.cacheReadTokens).toBe(40);
  });

  it("bounds every step's output", async () => {
    const model = scripted([textChunks("ok")]);
    await runAssistantLoop({
      model,
      system: "s",
      messages,
      tools: {},
      emit: () => {},
    });
    expect(ASSISTANT_MAX_OUTPUT_TOKENS).toBe(8192);
    expect(model.doStreamCalls[0]!.maxOutputTokens).toBe(
      ASSISTANT_MAX_OUTPUT_TOKENS,
    );
  });

  it("passes provider options through to the model", async () => {
    const model = scripted([textChunks("ok")]);
    await runAssistantLoop({
      model,
      system: "s",
      messages,
      tools: {},
      emit: () => {},
      providerOptions: {
        anthropic: { thinking: { type: "adaptive" }, effort: "high" },
      },
    });
    expect(model.doStreamCalls[0]!.providerOptions).toMatchObject({
      anthropic: { thinking: { type: "adaptive" }, effort: "high" },
    });
  });

  it("tells the model to trust the recorded outcome of a confirmation", () => {
    expect(ASSISTANT_PREAMBLE).toContain('"You confirmed these changes."');
    expect(ASSISTANT_PREAMBLE).toContain('"You dismissed these changes."');
    expect(ASSISTANT_PREAMBLE).toMatch(/trust it over your own earlier/);
  });

  it("asks for plain text, not Markdown", () => {
    expect(ASSISTANT_PREAMBLE).toMatch(/Write plain text/);
    expect(ASSISTANT_PREAMBLE).toMatch(/do not use Markdown/);
    expect(ASSISTANT_PREAMBLE).toMatch(/no asterisks, no headings/);
  });

  it("tells the model that staged does not mean done", () => {
    expect(ASSISTANT_PREAMBLE).toContain('{"staged": true}');
    expect(ASSISTANT_PREAMBLE).toMatch(/NOT happened/);
  });
});
