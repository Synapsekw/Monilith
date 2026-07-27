import { describe, expect, it } from "vitest";
import { buildReportHtml } from "@/lib/reports/export-html";
import { defaultReportConfig } from "@/lib/reports/config";

describe("buildReportHtml", () => {
  it("wraps the document in a full HTML doc with the report CSS", async () => {
    const html = await buildReportHtml({
      config: { ...defaultReportConfig(), title: "Q3" },
      model: { columns: [], groups: [] },
      kpis: {
        itemCount: 0,
        percentComplete: 0,
        overdueCount: 0,
        statusTally: [],
      },
      groupSummaries: [],
      chartSeries: null,
      boardName: "B",
      orgName: "O",
    });
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("--peri:#5866c4");
    expect(html).toContain("Q3");
  });

  it("inlines the chart CSS and the chart markup for a config with a chart block", async () => {
    const html = await buildReportHtml({
      config: defaultReportConfig(),
      model: { columns: [], groups: [] },
      kpis: {
        itemCount: 3,
        percentComplete: 33,
        overdueCount: 0,
        statusTally: [],
      },
      groupSummaries: [],
      chartSeries: {
        categories: [
          { key: "a", label: "Done", value: 2, color: "#5866c4" },
          { key: "b", label: "Stuck", value: 1, color: "#e34948" },
        ],
        total: 3,
        categoryName: "Status",
        empty: false,
      },
      boardName: "B",
      orgName: "O",
    });
    expect(html).toContain(".r-chart-ring");
    expect(html).toMatch(/<path[^>]+d="M/);
  });
});
