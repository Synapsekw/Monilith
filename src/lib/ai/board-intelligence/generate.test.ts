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

  it("disables thinking even on a model whose default shape enables it", async () => {
    // claude-sonnet-5 resolves to DEFAULT_SHAPE = adaptive thinking at effort
    // "high". Measured on the first real run: 5284 billed output tokens for a
    // ~700-token stored payload — roughly 85% of the bill, and of the two
    // minutes the user waits, was extended thinking nobody asked for. Assert
    // the override at the seam where it is written, so a refactor of
    // toRequestArgs cannot silently reinstate adaptive thinking here.
    const { adapter, generateStructured } = stubAdapter("claude-sonnet-5");
    await generateBoardIntelligence(EMPTY_INPUT, {
      adapter,
      apiKey: "k",
      baseUrl: null,
      model: "claude-sonnet-5",
    });
    const args = generateStructured.mock.calls[0][0];
    expect(requestShapeFor("claude-sonnet-5").thinking).toEqual({
      type: "adaptive",
    });
    expect(args.thinking).toEqual({ type: "disabled" });
    // `effort` is an output_config knob, not a thinking knob — it must keep
    // riding the model's own shape.
    expect(args.effort).toBe(requestShapeFor("claude-sonnet-5").effort);
  });

  it("keeps omitting effort on a model that rejects it", async () => {
    // Haiku 4.5 has no effort knob (HAIKU_SHAPE omits it). Overriding thinking
    // must not accidentally reintroduce the key the model rejects.
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
    expect(args.thinking).toEqual({ type: "disabled" });
    expect(args.effort).toBeUndefined();
  });
});
