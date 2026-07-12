import { describe, expect, it, vi } from "vitest";
import {
  buildBoardGenSystemPrompt,
  generateBoardProposal,
} from "@/lib/ai/board-generate";
import { BOARD_PROPOSAL_JSON_SCHEMA } from "@/lib/ai/board-gen-schema";
import type { ProviderAdapter } from "@/lib/ai/providers/types";

const USAGE = { inputTokens: 12, outputTokens: 8 };

function fakeAdapter(data: unknown) {
  const generate = vi.fn().mockResolvedValue({ data, usage: USAGE });
  const adapter = {
    generateStructured: generate,
  } as unknown as ProviderAdapter;
  return { adapter, generate };
}

describe("buildBoardGenSystemPrompt", () => {
  it("teaches the kind vocabulary, option shape, temp-id contract and design heuristics", () => {
    const p = buildBoardGenSystemPrompt();
    expect(p).toMatch(/status/);
    expect(p).toMatch(/dropdown/);
    expect(p).toMatch(/people/);
    expect(p).toMatch(/tempId/);
    // Which kinds carry options.
    expect(p).toMatch(/option/i);
    // Design heuristic: a usable starter board.
    expect(p).toMatch(/starter/i);
  });
});

describe("generateBoardProposal", () => {
  it("returns the adapter's proposal and passes the board schema through", async () => {
    const proposal = {
      name: "CRM",
      groups: [{ tempId: "g1", name: "Leads" }],
      columns: [{ tempId: "c1", name: "Status", kind: "status" }],
      items: [],
    };
    const { adapter, generate } = fakeAdapter(proposal);
    const res = await generateBoardProposal("build me a CRM", {
      adapter,
      apiKey: "k",
    });
    expect(res.proposal).toEqual(proposal);
    expect(res.usage).toEqual(USAGE);
    expect(generate.mock.calls[0][0].schema).toBe(BOARD_PROPOSAL_JSON_SCHEMA);
    expect(generate.mock.calls[0][0].user).toContain("build me a CRM");
  });

  it("threads feedback into the user message", async () => {
    const { adapter, generate } = fakeAdapter({
      name: "x",
      groups: [],
      columns: [],
      items: [],
    });
    await generateBoardProposal("a board", {
      adapter,
      apiKey: "k",
      feedback: "add a priority column",
    });
    expect(generate.mock.calls[0][0].user).toContain("add a priority column");
  });
});
