import { describe, expect, it, vi } from "vitest";
import { draftReportNarrative } from "@/lib/reports/ai-draft";
import type { BoardSnapshot } from "@/lib/ai/board-snapshot";

const snapshot: BoardSnapshot = {
  board: { id: "b1", name: "Board" },
  rowCount: 2,
  groups: [{ id: "g1", name: "Backlog" }],
  columns: [],
  columnStats: {},
  meta: { rowCount: 2, columnCount: 0, estimatedTokens: 10 },
};

describe("draftReportNarrative", () => {
  it("calls generateStructured and re-validates the result", async () => {
    const generateStructured = vi.fn(async () => ({
      data: { summary: "All good.", highlights: ["Shipped X"], risks: [] },
      usage: { inputTokens: 1, outputTokens: 1 },
    }));
    const adapter = { generateStructured } as never;
    const { narrative } = await draftReportNarrative(snapshot, {
      adapter,
      apiKey: "k",
    });
    expect(narrative.summary).toBe("All good.");
    expect(generateStructured).toHaveBeenCalledOnce();
  });

  it("throws when the model returns a malformed object", async () => {
    const adapter = {
      generateStructured: async () => ({
        data: { summary: 123 },
        usage: { inputTokens: 1, outputTokens: 1 },
      }),
    } as never;
    await expect(
      draftReportNarrative(snapshot, { adapter, apiKey: "k" }),
    ).rejects.toThrow();
  });
});
