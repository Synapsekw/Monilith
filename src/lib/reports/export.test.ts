import { describe, expect, it } from "vitest";
import { buildReportHtml } from "@/lib/reports/export-html";
import { defaultReportConfig } from "@/lib/reports/config";
import type { ReportBoardData } from "@/lib/reports/aggregate";
import type { Kpis } from "@/lib/reports/shape";

const NO_KPIS: Kpis = {
  itemCount: 0,
  percentComplete: 0,
  overdueCount: 0,
  statusTally: [],
};

/** One bound board contributing nothing — enough to exercise the per-board blocks. */
const emptyBoard = (id: string, name: string): ReportBoardData => ({
  boardId: id,
  boardName: name,
  model: { columns: [], groups: [] },
  kpis: NO_KPIS,
  groupSummaries: [],
  chartSeries: null,
});

describe("buildReportHtml", () => {
  it("wraps the document in a full HTML doc with the report CSS", async () => {
    const html = await buildReportHtml({
      config: { ...defaultReportConfig(), title: "Q3" },
      boards: [emptyBoard("b1", "Roadmap")],
      totals: NO_KPIS,
      pooledChartSeries: null,
      scopeLabel: "Roadmap",
      omittedBoardCount: 0,
      orgName: "O",
    });
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("--peri:#5866c4");
    expect(html).toContain("Q3");
  });

  it("inlines the chart CSS and the chart markup for a config with a chart block", async () => {
    const html = await buildReportHtml({
      config: defaultReportConfig(),
      boards: [emptyBoard("b1", "Roadmap")],
      totals: {
        itemCount: 3,
        percentComplete: 33,
        overdueCount: 0,
        statusTally: [],
      },
      pooledChartSeries: {
        categories: [
          { key: "a", label: "Done", value: 2, color: "#5866c4" },
          { key: "b", label: "Stuck", value: 1, color: "#e34948" },
        ],
        total: 3,
        categoryName: "Status",
        empty: false,
      },
      scopeLabel: "Roadmap",
      omittedBoardCount: 0,
      orgName: "O",
    });
    expect(html).toContain(".r-chart-ring");
    expect(html).toMatch(/<path[^>]+d="M/);
  });

  it("discloses boards the viewer could not read", async () => {
    const html = await buildReportHtml({
      config: defaultReportConfig(),
      boards: [emptyBoard("b1", "Roadmap")],
      totals: NO_KPIS,
      pooledChartSeries: null,
      scopeLabel: "Exec roll-up",
      omittedBoardCount: 2,
      orgName: "O",
    });
    expect(html).toContain("2 boards");
    expect(html).toContain("omitted");
  });
});
