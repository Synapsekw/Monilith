import { describe, expect, it, vi } from "vitest";
import {
  draftReportNarrative,
  MAX_COLUMNS_PER_BOARD,
} from "@/lib/reports/ai-draft";
import type { BoardSnapshot } from "@/lib/ai/board-snapshot";

function snapshot(
  name: string,
  over: Partial<BoardSnapshot> = {},
): BoardSnapshot {
  return {
    board: { id: `b-${name}`, name },
    rowCount: 2,
    groups: [{ id: "g1", name: "Backlog" }],
    columns: [],
    columnStats: {},
    meta: { rowCount: 2, columnCount: 0, estimatedTokens: 10 },
    ...over,
  };
}

const oneBoard = snapshot("Board");

/** Captures the prompts handed to the provider without running one. */
function recordingAdapter(
  data: unknown = {
    summary: "All good.",
    highlights: ["Shipped X"],
    risks: [],
  },
) {
  const generateStructured = vi.fn(
    async (_req: { system: string; user: string }) => ({
      data,
      usage: { inputTokens: 1, outputTokens: 1 },
      model: "test-model",
    }),
  );
  return { adapter: { generateStructured } as never, generateStructured };
}

describe("draftReportNarrative", () => {
  it("calls generateStructured and re-validates the result", async () => {
    const { adapter, generateStructured } = recordingAdapter();
    const { narrative } = await draftReportNarrative(
      { snapshots: [oneBoard], scope: "board" },
      { adapter, apiKey: "k" },
    );
    expect(narrative.summary).toBe("All good.");
    expect(generateStructured).toHaveBeenCalledOnce();
  });

  it("throws when the model returns a malformed object", async () => {
    const { adapter } = recordingAdapter({ summary: 123 });
    await expect(
      draftReportNarrative(
        { snapshots: [oneBoard], scope: "board" },
        { adapter, apiKey: "k" },
      ),
    ).rejects.toThrow();
  });

  it("names every board and every COLUMN in the user prompt", async () => {
    // Regression: columnStats is keyed by opaque column UUIDs, so the old
    // prompt sent stats for anonymous columns. Names must travel with them.
    const a = snapshot("Roadmap", {
      columns: [{ id: "c-1", name: "Status", kind: "status" }],
      columnStats: {
        "c-1": {
          fillRate: 0.5,
          distinctCount: 2,
          distribution: [{ label: "Done", count: 3 }],
        },
      },
      rowCount: 6,
    });
    const b = snapshot("Hiring", {
      columns: [{ id: "c-2", name: "Owner", kind: "people" }],
      columnStats: { "c-2": { fillRate: 1, distinctCount: 4 } },
      rowCount: 4,
    });
    const { adapter, generateStructured } = recordingAdapter();
    await draftReportNarrative(
      { snapshots: [a, b], scope: "boards" },
      { adapter, apiKey: "k" },
    );
    const { user, system } = generateStructured.mock.calls[0][0];
    expect(user).toContain("Roadmap");
    expect(user).toContain("Hiring");
    expect(user).toContain("Status");
    expect(user).toContain("Owner");
    // opaque UUID keys are no longer the only handle on a column
    expect(user).toContain("Done");
    // total across the whole report scope, not per board
    expect(user).toContain("10");
    // the system prompt must not claim there is exactly one board
    expect(system).not.toContain("a project board");
  });

  it("states N of M when the board set was truncated", async () => {
    const { adapter, generateStructured } = recordingAdapter();
    await draftReportNarrative(
      {
        snapshots: [snapshot("One"), snapshot("Two")],
        scope: "portfolio",
        totalBoardCount: 9,
      },
      { adapter, apiKey: "k" },
    );
    const { user } = generateStructured.mock.calls[0][0];
    expect(user).toContain("2 of 9");
    expect(user).toContain("portfolio");
  });

  it("caps the columns summarised per board and says so", async () => {
    const columns = Array.from(
      { length: MAX_COLUMNS_PER_BOARD + 5 },
      (_, i) => ({ id: `c-${i}`, name: `Col${i}`, kind: "text" }),
    );
    const { adapter, generateStructured } = recordingAdapter();
    await draftReportNarrative(
      { snapshots: [snapshot("Wide", { columns })], scope: "board" },
      { adapter, apiKey: "k" },
    );
    const { user } = generateStructured.mock.calls[0][0];
    expect(user).toContain(`Col${MAX_COLUMNS_PER_BOARD - 1}`);
    expect(user).not.toContain(`Col${MAX_COLUMNS_PER_BOARD}`);
    expect(user).toContain(
      `${MAX_COLUMNS_PER_BOARD} of ${MAX_COLUMNS_PER_BOARD + 5}`,
    );
  });

  it("sends no raw cell values or item names", async () => {
    // Privacy boundary: schema + aggregates only.
    const { adapter, generateStructured } = recordingAdapter();
    await draftReportNarrative(
      { snapshots: [oneBoard], scope: "board" },
      { adapter, apiKey: "k" },
    );
    const { user } = generateStructured.mock.calls[0][0];
    expect(user).not.toContain("items");
    expect(user).not.toContain("cellValues");
  });

  it("rejects an empty board set instead of prompting the model", async () => {
    const { adapter, generateStructured } = recordingAdapter();
    await expect(
      draftReportNarrative(
        { snapshots: [], scope: "template" },
        { adapter, apiKey: "k" },
      ),
    ).rejects.toThrow();
    expect(generateStructured).not.toHaveBeenCalled();
  });
});
