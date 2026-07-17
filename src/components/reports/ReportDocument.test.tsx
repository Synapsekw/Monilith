// src/components/reports/ReportDocument.test.tsx
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ReportDocument } from "@/components/reports/ReportDocument";
import { defaultReportConfig } from "@/lib/reports/config";
import type { ReportModel } from "@/lib/reports/shape";

const model: ReportModel = { columns: [], groups: [] };

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
        boardName="B"
        orgName="O"
      />,
    );
    expect(html).not.toContain("r-cover");
  });
});
