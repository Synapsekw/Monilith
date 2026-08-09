import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ChartBlock } from "@/components/reports/blocks/ChartBlock";
import type { ChartSeries } from "@/lib/reports/chart-data";
import type { ChartBlockOptions } from "@/lib/reports/config";

const OPTS: ChartBlockOptions = {
  variant: "donut",
  source: "status",
  columnId: null,
  title: "",
  maxCategories: 6,
  boardScope: { mode: "all" },
};

const series = (over: Partial<ChartSeries> = {}): ChartSeries => ({
  categories: [
    { key: "a", label: "Done", value: 12, color: "#5866c4" },
    { key: "b", label: "Working on it", value: 7, color: "#eb6834" },
    { key: "c", label: "Stuck", value: 3, color: "#e34948" },
  ],
  total: 22,
  categoryName: "Status",
  empty: false,
  ...over,
});

describe("ChartBlock — server-rendered geometry", () => {
  it("donut emits real SVG arc geometry under renderToStaticMarkup", () => {
    const html = renderToStaticMarkup(
      <ChartBlock series={series()} options={{ ...OPTS, variant: "donut" }} />,
    );
    expect(html).toContain("<svg");
    // A recharts-style empty wrapper would have none of these:
    expect(html).toMatch(/<path[^>]+d="M/);
    expect((html.match(/<path/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(html).toMatch(/\sA\s/); // elliptical-arc command
    expect(html.length).toBeGreaterThan(500);
  });

  it("donut renders one legend row per category with label, count and share", () => {
    const html = renderToStaticMarkup(
      <ChartBlock series={series()} options={{ ...OPTS, variant: "donut" }} />,
    );
    expect((html.match(/r-lg-row/g) ?? []).length).toBe(3);
    expect(html).toContain("Working on it");
    expect(html).toContain("12");
    expect(html).toContain("55%"); // 12/22
  });

  it("donut shows the total in the ring centre", () => {
    const html = renderToStaticMarkup(
      <ChartBlock series={series()} options={{ ...OPTS, variant: "donut" }} />,
    );
    expect(html).toContain("r-chart-total");
    expect(html).toContain(">22<");
  });

  it("bars emit one CSS-width row per category, no SVG needed", () => {
    const html = renderToStaticMarkup(
      <ChartBlock series={series()} options={{ ...OPTS, variant: "bars" }} />,
    );
    expect((html.match(/r-bar-row/g) ?? []).length).toBe(3);
    expect(html).toContain("width:100%"); // longest bar
    expect(html).toContain("Stuck");
    expect(html).not.toContain("<svg");
  });

  it("uses the derived title when options.title is blank", () => {
    const html = renderToStaticMarkup(
      <ChartBlock series={series()} options={OPTS} />,
    );
    expect(html).toContain("Items by Status");
  });

  it("uses the explicit title when set", () => {
    const html = renderToStaticMarkup(
      <ChartBlock
        series={series()}
        options={{ ...OPTS, title: "Where the work sits" }}
      />,
    );
    expect(html).toContain("Where the work sits");
    expect(html).not.toContain("Items by Status");
  });

  it("renders a quiet empty state, never an error", () => {
    const html = renderToStaticMarkup(
      <ChartBlock
        series={{ categories: [], total: 0, categoryName: "", empty: true }}
        options={OPTS}
      />,
    );
    expect(html).toContain("r-chart-empty");
    expect(html).not.toContain("<svg");
  });

  it("renders a stat line instead of a one-slice ring for a single category", () => {
    const html = renderToStaticMarkup(
      <ChartBlock
        series={series({
          categories: [{ key: "a", label: "Done", value: 9, color: "#5866c4" }],
          total: 9,
        })}
        options={OPTS}
      />,
    );
    expect(html).toContain("r-chart-stat");
    expect(html).not.toContain("<svg");
    expect(html).toContain("Done");
    expect(html).toContain("9");
  });

  it("never emits an svg id, gradient or filter (instance-independent markup)", () => {
    const html = renderToStaticMarkup(
      <ChartBlock series={series()} options={OPTS} />,
    );
    expect(html).not.toContain("<defs");
    expect(html).not.toMatch(/\sid="/);
    expect(html).not.toContain("url(#");
  });
});
