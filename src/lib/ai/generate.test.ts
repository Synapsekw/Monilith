import { describe, expect, it, vi } from "vitest";
import { generateProposal, buildSystemPrompt } from "@/lib/ai/generate";
import type { BoardSnapshot } from "@/lib/ai/board-snapshot";

const snap: BoardSnapshot = {
  board: { id: "b1", name: "Sprint" },
  rowCount: 5,
  columns: [{ id: "c-status", name: "Status", kind: "status", options: [] }],
  columnStats: { "c-status": { fillRate: 1, distinctCount: 2 } },
  meta: { rowCount: 5, columnCount: 1, estimatedTokens: 50 },
};

// generate.ts uses client.messages.parse() with output_config.format
// (jsonSchemaOutputFormat) and reads message.parsed_output. The mock mimics
// exactly that shape — parsed_output carries the structured proposal.
function fakeClient(proposalJson: unknown) {
  return {
    messages: {
      parse: vi.fn().mockResolvedValue({
        content: [{ type: "text", text: JSON.stringify(proposalJson) }],
        parsed_output: proposalJson,
      }),
    },
  } as never;
}

describe("buildSystemPrompt", () => {
  it("teaches the widget vocabulary", () => {
    const p = buildSystemPrompt();
    expect(p).toMatch(/number/);
    expect(p).toMatch(/chart/);
    expect(p).toMatch(/battery/);
    expect(p).toMatch(/list/);
    expect(p).toMatch(/12/); // 12-column grid
  });
});

describe("generateProposal", () => {
  it("returns the model's proposal object", async () => {
    const proposal = {
      name: "Sprint overview",
      widgets: [{ kind: "number", title: "Total", config: { agg: "count" } }],
    };
    const client = fakeClient(proposal);
    const res = await generateProposal(snap, { client });
    expect(res.name).toBe("Sprint overview");
    expect(res.widgets).toHaveLength(1);
  });

  it("passes feedback into the user message when provided", async () => {
    const client = fakeClient({ name: "x", widgets: [] });
    await generateProposal(snap, { client, feedback: "more charts please" });
    const call = (
      client as never as { messages: { parse: ReturnType<typeof vi.fn> } }
    ).messages.parse.mock.calls[0][0];
    expect(JSON.stringify(call)).toContain("more charts please");
  });
});
