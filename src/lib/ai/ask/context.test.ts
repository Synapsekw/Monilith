import { describe, expect, it, vi } from "vitest";
import {
  buildAskMessages,
  splitForCompaction,
  composeSystem,
  summarize,
  generateTitle,
} from "./context";
import type { MessageRow } from "./conversations";

const row = (
  role: "user" | "assistant",
  content: string,
  i: number,
): MessageRow => ({
  id: String(i),
  role,
  content,
  tool_trace: null,
  created_at: `2026-01-01T00:00:0${i}Z`,
});

describe("buildAskMessages", () => {
  it("maps rows to Anthropic message params in order", () => {
    const msgs = buildAskMessages([
      row("user", "hi", 1),
      row("assistant", "hello", 2),
    ]);
    expect(msgs).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ]);
  });
});

describe("splitForCompaction", () => {
  it("folds everything older than the most recent N, keeps N verbatim", () => {
    const rows = Array.from({ length: 14 }, (_, i) =>
      row(i % 2 ? "assistant" : "user", `m${i}`, i),
    );
    const { toFold, recent } = splitForCompaction(rows, 10);
    expect(recent).toHaveLength(10);
    expect(toFold).toHaveLength(4);
    expect(recent[0].content).toBe("m4");
  });
  it("folds nothing when at or under the budget", () => {
    const rows = Array.from({ length: 8 }, (_, i) => row("user", `m${i}`, i));
    expect(splitForCompaction(rows, 10).toFold).toHaveLength(0);
  });
});

describe("composeSystem", () => {
  it("appends the summary block when present", () => {
    expect(composeSystem("BASE", "prior stuff")).toContain("prior stuff");
    expect(composeSystem("BASE", null)).toBe("BASE");
  });
});

describe("summarize", () => {
  it("folds turns into an updated summary via the injected client", async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "compact summary" }],
      usage: { input_tokens: 30, output_tokens: 8 },
    });
    const res = await summarize({ create }, "model-x", "prior", [
      row("user", "what's overdue", 1),
    ]);
    expect(res.summary).toBe("compact summary");
    expect(res.usage).toEqual({ inputTokens: 30, outputTokens: 8 });
    expect(create).toHaveBeenCalledOnce();
  });
});

describe("generateTitle", () => {
  it("returns the model's title, falling back to a slice of the question", async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "Overdue items" }],
      usage: { input_tokens: 5, output_tokens: 2 },
    });
    const res = await generateTitle({ create }, "model-x", "what is overdue?");
    expect(res.title).toBe("Overdue items");

    const emptyCreate = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "" }],
      usage: { input_tokens: 5, output_tokens: 0 },
    });
    const fallback = await generateTitle(
      { create: emptyCreate },
      "model-x",
      "a".repeat(80),
    );
    expect(fallback.title).toBe("a".repeat(60));
  });
});
