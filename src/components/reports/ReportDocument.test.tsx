// src/components/reports/ReportDocument.test.tsx
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ReportDocument } from "@/components/reports/ReportDocument";
import { defaultReportConfig } from "@/lib/reports/config";
import type { ReportModel } from "@/lib/reports/shape";
import { computeChartSeries } from "@/lib/reports/chart-data";
import type { ChartSeries } from "@/lib/reports/chart-data";

const model: ReportModel = { columns: [], groups: [] };

const chartSeries: ChartSeries = {
  categories: [
    { key: "a", label: "Done", value: 4, color: "#5866c4" },
    { key: "b", label: "Stuck", value: 1, color: "#e34948" },
  ],
  total: 5,
  categoryName: "Status",
  empty: false,
};

describe("ReportDocument", () => {
  it("renders the cover title and skips disabled blocks", () => {
    const config = defaultReportConfig();
    config.title = "Q3 Launch";
    const html = renderToStaticMarkup(
      <ReportDocument
        config={config}
        model={model}
        kpis={{
          itemCount: 0,
          percentComplete: 0,
          overdueCount: 0,
          statusTally: [],
        }}
        groupSummaries={[]}
        chartSeries={null}
        boardName="Marketing"
        orgName="Acme"
      />,
    );
    expect(html).toContain("Q3 Launch");
  });

  it("renders nothing for an empty block list", () => {
    const html = renderToStaticMarkup(
      <ReportDocument
        config={{ v: 1, title: "T", blocks: [] }}
        model={model}
        kpis={{
          itemCount: 0,
          percentComplete: 0,
          overdueCount: 0,
          statusTally: [],
        }}
        groupSummaries={[]}
        chartSeries={null}
        boardName="B"
        orgName="O"
      />,
    );
    expect(html).not.toContain("r-cover");
  });
});

describe("ReportDocument — chart block", () => {
  it("renders the chart block when enabled", () => {
    const config = defaultReportConfig();
    const html = renderToStaticMarkup(
      <ReportDocument
        config={config}
        model={model}
        kpis={{
          itemCount: 5,
          percentComplete: 80,
          overdueCount: 0,
          statusTally: [],
        }}
        groupSummaries={[]}
        chartSeries={chartSeries}
        boardName="Marketing"
        orgName="Acme"
      />,
    );
    expect(html).toContain("Items by Status");
    expect(html).toContain("<svg");
  });

  it("omits the chart entirely when the block is disabled", () => {
    const config = defaultReportConfig();
    config.blocks = config.blocks.map((b) =>
      b.type === "chart" ? { ...b, enabled: false } : b,
    );
    const html = renderToStaticMarkup(
      <ReportDocument
        config={config}
        model={model}
        kpis={{
          itemCount: 5,
          percentComplete: 80,
          overdueCount: 0,
          statusTally: [],
        }}
        groupSummaries={[]}
        chartSeries={chartSeries}
        boardName="M"
        orgName="A"
      />,
    );
    expect(html).not.toContain("r-chart-ring");
  });

  it("renders the chart's empty state when chartSeries is null", () => {
    const html = renderToStaticMarkup(
      <ReportDocument
        config={defaultReportConfig()}
        model={model}
        kpis={{
          itemCount: 0,
          percentComplete: 0,
          overdueCount: 0,
          statusTally: [],
        }}
        groupSummaries={[]}
        chartSeries={null}
        boardName="M"
        orgName="A"
      />,
    );
    expect(html).toContain("r-chart-empty");
    expect(typeof computeChartSeries).toBe("function");
  });
});
