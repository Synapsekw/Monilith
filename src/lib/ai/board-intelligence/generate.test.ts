import { describe, expect, it, vi } from "vitest";
import { generateBoardIntelligence } from "./generate";
import { BOARD_INTELLIGENCE_JSON_SCHEMA } from "./schema";
import { requestShapeFor } from "@/lib/ai/model-map";
import type { ProviderAdapter } from "@/lib/ai/providers/types";
import type { PromptInput } from "./prompt";

const EMPTY_INPUT: PromptInput = {
  snapshot: {
    board: { id: "b", name: "B" },
    rowCount: 0,
    groups: [],
    columns: [],
    columnStats: {},
    meta: { rowCount: 0, columnCount: 0, estimatedTokens: 1 },
  },
  ctx: {
    boardId: "b",
    orgId: "o",
    items: new Map(),
    columns: new Map(),
    members: new Map(),
    signals: [],
  },
  signals: [],
  transcript: "",
  now: "2026-09-11T00:00:00.000Z",
  timezone: "UTC",
  cellValues: [],
  itemsByRecency: [],
};

function stubAdapter(model: string) {
  const generateStructured = vi.fn().mockResolvedValue({
    data: { brief: "ok", suggestions: [] },
    usage: { inputTokens: 10, outputTokens: 5 },
    model,
  });
  const adapter = {
    kind: "anthropic",
    validateKey: vi.fn(),
    generateStructured,
    generateProposal: vi.fn(),
  } as unknown as ProviderAdapter;
  return { adapter, generateStructured };
}

describe("generateBoardIntelligence", () => {
  it("calls generateStructured with the system/user prompts and the JSON schema, and passes the wire model", async () => {
    const { adapter, generateStructured } = stubAdapter("claude-x");
    const out = await generateBoardIntelligence(EMPTY_INPUT, {
      adapter,
      apiKey: "k",
      baseUrl: null,
      model: "claude-wire",
    });
    expect(generateStructured).toHaveBeenCalledTimes(1);
    const args = generateStructured.mock.calls[0][0];
    expect(args.model).toBe("claude-wire");
    expect(args.schema).toBe(BOARD_INTELLIGENCE_JSON_SCHEMA);
    expect(args.system).toMatch(/Intelligence layer/);
    expect(args.user).toContain("=== SIGNALS ===");
    expect(out).toEqual({
      raw: { brief: "ok", suggestions: [] },
      usage: { inputTokens: 10, outputTokens: 5 },
      model: "claude-x",
    });
  });

  it("lowers effort below the model's default shape", async () => {
    // claude-sonnet-5 resolves to DEFAULT_SHAPE = adaptive thinking at effort
    // "high". Measured on the first real run: 5284 billed output tokens for a
    // ~700-token stored payload — roughly 85% of the bill, and of the two
    // minutes the user waits, was reasoning nobody asked for. Effort is the
    // lever; assert it at the seam, so a refactor of toRequestArgs cannot
    // silently restore "high" here.
    const { adapter, generateStructured } = stubAdapter("claude-sonnet-5");
    await generateBoardIntelligence(EMPTY_INPUT, {
      adapter,
      apiKey: "k",
      baseUrl: null,
      model: "claude-sonnet-5",
    });
    const args = generateStructured.mock.calls[0][0];
    expect(requestShapeFor("claude-sonnet-5").effort).toBe("high");
    expect(args.effort).toBe("low");
  });

  it("never turns thinking off — Fable rejects that with a 400", async () => {
    // The regression this test exists for: an earlier version of this fix sent
    // `thinking: { type: "disabled" }`. Claude Fable 5/5.1 reject that outright
    // (400), and both are ACTIVE rows in the model catalog — `pickModel` puts
    // an org's default model above the feature's tier hint, so a single admin
    // picking Fable in Settings would have made every run fail. Whatever this
    // feature overrides, it must leave the model's own thinking shape alone.
    for (const model of ["claude-fable-5.1", "claude-opus-5"]) {
      const { adapter, generateStructured } = stubAdapter(model);
      await generateBoardIntelligence(EMPTY_INPUT, {
        adapter,
        apiKey: "k",
        baseUrl: null,
        model,
      });
      const args = generateStructured.mock.calls[0][0];
      expect(args.thinking).toEqual(requestShapeFor(model).thinking);
      expect(args.thinking).not.toEqual({ type: "disabled" });
    }
  });

  it("keeps omitting effort on a model that rejects the key", async () => {
    // Haiku 4.5 has no effort knob (HAIKU_SHAPE omits it), and sending the key
    // at all is a 400 — so the override must not introduce it. `toBeUndefined`
    // would pass for a present-and-undefined key too, which is the regression
    // this guards, hence the `in` check.
    const { adapter, generateStructured } = stubAdapter(
      "claude-haiku-4-5-20251001",
    );
    await generateBoardIntelligence(EMPTY_INPUT, {
      adapter,
      apiKey: "k",
      baseUrl: null,
      model: "claude-haiku-4-5-20251001",
    });
    const args = generateStructured.mock.calls[0][0];
    expect("effort" in args && args.effort !== undefined).toBe(false);
    expect(args.thinking).toEqual({ type: "enabled", budget_tokens: 1024 });
  });
});
