import { describe, expect, it, vi } from "vitest";
import { generateProposal, buildSystemPrompt } from "@/lib/ai/generate";
import type { BoardSnapshot } from "@/lib/ai/board-snapshot";
import type { ProviderAdapter } from "@/lib/ai/providers/types";

const snap: BoardSnapshot = {
  board: { id: "b1", name: "Sprint" },
  rowCount: 5,
  groups: [{ id: "g1", name: "Backlog" }],
  columns: [{ id: "c-status", name: "Status", kind: "status", options: [] }],
  columnStats: { "c-status": { fillRate: 1, distinctCount: 2 } },
  meta: { rowCount: 5, columnCount: 1, estimatedTokens: 50 },
};

const USAGE = { inputTokens: 10, outputTokens: 5 };

function fakeAdapter(proposalJson: unknown) {
  const generate = vi
    .fn()
    .mockResolvedValue({ proposal: proposalJson, usage: USAGE });
  const adapter = { generateProposal: generate } as unknown as ProviderAdapter;
  return { adapter, generate };
}

describe("buildSystemPrompt", () => {
  it("teaches the widget vocabulary", () => {
    const p = buildSystemPrompt();
    expect(p).toMatch(/number/);
    expect(p).toMatch(/chart/);
    expect(p).toMatch(/battery/);
    expect(p).toMatch(/list/);
    expect(p).toMatch(/config/i); // instructs the model to populate widget config
  });
});

describe("generateProposal", () => {
  it("returns the adapter's proposal object", async () => {
    const proposal = {
      name: "Sprint overview",
      widgets: [{ kind: "number", title: "Total", config: { agg: "count" } }],
    };
    const { adapter } = fakeAdapter(proposal);
    const res = await generateProposal(snap, {
      adapter,
      apiKey: "k",
      model: "claude-sonnet-5",
    });
    expect(res.proposal.name).toBe("Sprint overview");
    expect(res.proposal.widgets).toHaveLength(1);
    expect(res.usage).toEqual(USAGE);
  });

  it("passes feedback into the user message when provided", async () => {
    const { adapter, generate } = fakeAdapter({ name: "x", widgets: [] });
    await generateProposal(snap, {
      adapter,
      apiKey: "k",
      model: "claude-sonnet-5",
      feedback: "more charts please",
    });
    const call = generate.mock.calls[0][0];
    expect(call.user).toContain("more charts please");
  });
});
