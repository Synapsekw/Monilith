import { describe, expect, it } from "vitest";
import { buildReportHtml } from "@/lib/reports/export-html";
import { defaultReportConfig } from "@/lib/reports/config";

describe("buildReportHtml", () => {
  it("wraps the document in a full HTML doc with the report CSS", () => {
    const html = buildReportHtml({
      config: { ...defaultReportConfig(), title: "Q3" },
      model: { columns: [], groups: [] },
      kpis: {
        itemCount: 0,
        percentComplete: 0,
        overdueCount: 0,
        statusTally: [],
      },
      groupSummaries: [],
      boardName: "B",
      orgName: "O",
    });
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("--peri:#5866c4");
    expect(html).toContain("Q3");
  });
});
