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

  // Regression guard. Omitting `thinking` on a Sonnet-tier model means ADAPTIVE
  // thinking at effort "high", and max_tokens caps thinking PLUS text. A
  // thinking block eats this 512-token budget whole, so the response comes back
  // with stop_reason "max_tokens" and NO text block — textOf() returns "", and
  // /api/ask persists that empty summary while advancing summarized_upto,
  // permanently dropping the folded turns with no error anywhere.
  it("disables thinking — 512 tokens cannot hold a thinking block AND a summary", async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "s" }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    await summarize({ create }, "model-x", null, [row("user", "hi", 1)]);
    const params = create.mock.calls[0][0];
    expect(params.thinking).toEqual({ type: "disabled" });
    expect(params.max_tokens).toBe(512);
  });

  it("returns an empty summary when the model emits no text block", async () => {
    // The failure shape the guard above prevents, pinned so the blast radius
    // stays visible: no text block in, empty summary out.
    const create = vi.fn().mockResolvedValue({
      content: [{ type: "thinking", thinking: "" }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const res = await summarize({ create }, "model-x", "prior", [
      row("user", "hi", 1),
    ]);
    expect(res.summary).toBe("");
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

  // Regression guard — see summarize's. 24 tokens cannot fit a thinking block
  // at all, so adaptive thinking here would return no text on every call and
  // every conversation would silently fall back to the question-slice title.
  it("disables thinking — 24 tokens cannot fit a thinking block", async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "Title" }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    await generateTitle({ create }, "model-x", "q");
    const params = create.mock.calls[0][0];
    expect(params.thinking).toEqual({ type: "disabled" });
    expect(params.max_tokens).toBe(24);
  });
});
