import { describe, it, expect } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import type { MessageRow } from "@/lib/ai/ask/conversations";
import { summarizeThread, titleThread } from "./thread-housekeeping";

const usage = {
  inputTokens: { total: 12, noCache: 12, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

function model(text: string, seen: { prompt?: unknown } = {}) {
  return new MockLanguageModelV4({
    doGenerate: async (options) => {
      seen.prompt = options.prompt;
      return {
        content: [{ type: "text", text }],
        finishReason: { unified: "stop", raw: undefined },
        usage,
        warnings: [],
      };
    },
  });
}

const rows = [
  {
    id: "1",
    role: "user",
    content: "What is stuck?",
    tool_trace: null,
    created_at: "t",
    agent_id: null,
  },
  {
    id: "2",
    role: "assistant",
    content: "Pricing page copy.",
    tool_trace: null,
    created_at: "t",
    agent_id: null,
  },
] as MessageRow[];

describe("thread housekeeping", () => {
  it("summarises with the prior summary and the folded turns in the prompt", async () => {
    const seen: { prompt?: unknown } = {};
    const r = await summarizeThread(model("Summary.", seen), "Earlier.", rows);
    expect(r.summary).toBe("Summary.");
    expect(r.usage.outputTokens).toBe(5);
    const prompt = JSON.stringify(seen.prompt);
    expect(prompt).toContain("Earlier.");
    expect(prompt).toContain("user: What is stuck?");
  });

  it("returns a trimmed title capped at 120 characters", async () => {
    const r = await titleThread(
      model("  Stuck items on Q4 launch  "),
      "What is stuck?",
    );
    expect(r.title).toBe("Stuck items on Q4 launch");
  });

  it("falls back to the question when the model returns nothing", async () => {
    const r = await titleThread(
      model(""),
      "What is stuck on the launch board right now?",
    );
    expect(r.title).toBe(
      "What is stuck on the launch board right now?".slice(0, 60),
    );
  });

  it("keeps the prior summary when the model returns no text", async () => {
    const r = await summarizeThread(model(""), "Earlier.", rows);
    expect(r.summary).toBe("Earlier.");
  });
});
