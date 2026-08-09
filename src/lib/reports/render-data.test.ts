import { describe, expect, it } from "vitest";
import { deriveRenderData } from "@/lib/reports/render-data";
import { defaultReportConfig, type ReportConfig } from "@/lib/reports/config";
import type { BoardPayload } from "@/lib/boards/queries";

// ---------------------------------------------------------------- fixtures
// File-local, matching aggregate.test.ts: only the fields the pure per-board
// shapers actually read.

/** A board whose single status column carries one label per item. */
function payload(id: string, name: string, labels: string[]): BoardPayload {
  const options = [...new Set(labels)];
  return {
    board: { id, name },
    columns: [
      {
        id: `${id}-c1`,
        name: "Status",
        kind: "status",
        position: 0,
        settings: {
          options: options.map((label, i) => ({ id: `${id}-o${i}`, label })),
        },
      },
    ],
    groups: [{ id: `${id}-g1`, name: "Now", position: 0, color: null }],
    items: labels.map((_, i) => ({
      id: `${id}-i${i}`,
      name: `i${i}`,
      group_id: `${id}-g1`,
      parent_id: null,
      position: i,
    })),
    cellValues: labels.map((label, i) => ({
      item_id: `${id}-i${i}`,
      column_id: `${id}-c1`,
      value: { optionId: `${id}-o${options.indexOf(label)}` },
    })),
  } as unknown as BoardPayload;
}

const NAMES = new Map<string, string>();

/** The default config with every chart block removed. */
function configWithoutChart(): ReportConfig {
  const base = defaultReportConfig();
  return { ...base, blocks: base.blocks.filter((b) => b.type !== "chart") };
}

/** The default config with the chart block's `maxCategories` overridden. */
function configWithChart(maxCategories: number): ReportConfig {
  const base = defaultReportConfig();
  return {
    ...base,
    blocks: base.blocks.map((b) =>
      b.type === "chart"
        ? { ...b, enabled: true, options: { ...b.options, maxCategories } }
        : b,
    ),
  };
}

// ------------------------------------------------------------------- tests

describe("deriveRenderData", () => {
  it("returns empty boards, zeroed totals and no chart for zero payloads", () => {
    const d = deriveRenderData([], NAMES, configWithChart(6));
    expect(d.boards).toEqual([]);
    expect(d.totals).toEqual({
      itemCount: 0,
      percentComplete: 0,
      overdueCount: 0,
      statusTally: [],
    });
    // Nothing chartable — not an empty series, `null`.
    expect(d.pooledChartSeries).toBeNull();
  });

  it("mirrors the single board's kpis into totals for one payload", () => {
    const d = deriveRenderData(
      [payload("b1", "Roadmap", ["Done", "Working"])],
      NAMES,
      configWithChart(6),
    );
    expect(d.boards).toHaveLength(1);
    expect(d.boards[0].boardId).toBe("b1");
    expect(d.boards[0].boardName).toBe("Roadmap");
    expect(d.totals).toEqual(d.boards[0].kpis);
    expect(d.totals.itemCount).toBe(2);
    expect(d.pooledChartSeries?.total).toBe(2);
    expect(d.pooledChartSeries?.categories.map((c) => c.label).sort()).toEqual([
      "Done",
      "Working",
    ]);
  });

  it("pools kpis and merges chart series across N payloads", () => {
    const d = deriveRenderData(
      [
        payload("b1", "Roadmap", ["Done", "Working"]),
        payload("b2", "Ops", ["Done", "Done", "Stuck"]),
      ],
      NAMES,
      configWithChart(6),
    );
    expect(d.boards.map((b) => b.boardId)).toEqual(["b1", "b2"]);
    expect(d.totals.itemCount).toBe(5);
    // Merged BY LABEL across boards — "Done" exists on both, once in the pool.
    expect(d.pooledChartSeries?.total).toBe(5);
    expect(
      d.pooledChartSeries?.categories.map((c) => [c.label, c.value]),
    ).toEqual([
      ["Done", 3],
      ["Stuck", 1],
      ["Working", 1],
    ]);
  });

  it("returns a null chart series when no chart block is enabled", () => {
    const d = deriveRenderData(
      [payload("b1", "Roadmap", ["Done", "Working"])],
      NAMES,
      configWithoutChart(),
    );
    expect(d.pooledChartSeries).toBeNull();
    // ...and no per-board series either, so the document has nothing to draw.
    expect(d.boards[0].chartSeries).toBeNull();
  });

  it("ignores a DISABLED chart block and uses the first ENABLED one", () => {
    const base = configWithChart(6);
    const chart = base.blocks.find((b) => b.type === "chart");
    if (chart?.type !== "chart")
      throw new Error("fixture lost its chart block");
    const config: ReportConfig = {
      ...base,
      blocks: [
        // A disabled chart pinned to board groups must NOT win.
        { ...chart, enabled: false, options: { ...chart.options } },
        chart,
      ],
    };
    const d = deriveRenderData(
      [payload("b1", "Roadmap", ["Done"])],
      NAMES,
      config,
    );
    expect(d.pooledChartSeries?.categoryName).toBe("Status");
  });

  it("caps merged categories with the chart block's maxCategories", () => {
    const boards = [payload("b1", "Roadmap", ["A", "B", "C", "D", "E"])];
    const wide = deriveRenderData(boards, NAMES, configWithChart(6));
    expect(
      wide.pooledChartSeries?.categories.some((c) => c.key === "__other"),
    ).toBe(false);

    const tight = deriveRenderData(boards, NAMES, configWithChart(3));
    expect(
      tight.pooledChartSeries?.categories.some((c) => c.key === "__other"),
    ).toBe(true);
  });
});
