import { describe, expect, it, vi } from "vitest";
import { generateBoardIntelligence } from "./generate";
import { BOARD_INTELLIGENCE_JSON_SCHEMA } from "./schema";
import type { ProviderAdapter } from "@/lib/ai/providers/types";

describe("generateBoardIntelligence", () => {
  it("calls generateStructured with the system/user prompts and the JSON schema, and passes the wire model", async () => {
    const generateStructured = vi.fn().mockResolvedValue({
      data: { brief: "ok", suggestions: [] },
      usage: { inputTokens: 10, outputTokens: 5 },
      model: "claude-x",
    });
    const adapter = {
      kind: "anthropic",
      validateKey: vi.fn(),
      generateStructured,
      generateProposal: vi.fn(),
    } as unknown as ProviderAdapter;
    const out = await generateBoardIntelligence(
      {
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
        },
        signals: [],
        transcript: "",
        now: "2026-09-11T00:00:00.000Z",
        timezone: "UTC",
        cellValues: [],
        itemsByRecency: [],
      },
      { adapter, apiKey: "k", baseUrl: null, model: "claude-wire" },
    );
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
});
