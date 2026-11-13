import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { simulateReadableStream, tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import {
  ASSISTANT_MAX_STEPS,
  ASSISTANT_PREAMBLE,
  runAssistantLoop,
  type AssistantEvent,
} from "./runtime";

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

  it("tells the model that staged does not mean done", () => {
    expect(ASSISTANT_PREAMBLE).toContain('{"staged": true}');
    expect(ASSISTANT_PREAMBLE).toMatch(/NOT happened/);
  });
});
