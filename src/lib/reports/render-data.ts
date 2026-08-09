/**
 * The ONE derivation from board payloads to `ReportDocument` props.
 *
 * This module is the preview/PDF parity guarantee. The client builder renders
 * `<ReportDocument>` from data it derives in the browser; `exportReportPdf`
 * renders the same component on the server. If those two ever compute their
 * props independently, the exported PDF stops matching the document the user
 * approved on screen — silently, and only for whichever branch drifted. Both
 * paths call `deriveRenderData`, so there is exactly one place that decision
 * lives.
 *
 * PURE, and deliberately WITHOUT `import "server-only"`: a client component has
 * to be able to import it. Everything it touches (`aggregate.ts`, `shape.ts`,
 * `chart-data.ts`, `config.ts`) is pure too — the `BoardPayload` import is
 * `import type`, so the server-only `@/lib/boards/queries` module is erased at
 * compile time and never enters a client bundle.
 */
import type { BoardPayload } from "@/lib/boards/queries";
import type { ChartBlockOptions, ReportConfig } from "@/lib/reports/config";
import type { Kpis } from "@/lib/reports/shape";
import type { ChartSeries } from "@/lib/reports/chart-data";
import {
  buildReportBoardData,
  mergeChartSeries,
  poolKpis,
  type ReportBoardData,
} from "@/lib/reports/aggregate";

export type ReportRenderData = {
  /** One entry per payload, in the order the payloads were bound. */
  boards: ReportBoardData[];
  /** `poolKpis` over the per-board KPIs — the report-wide strip. */
  totals: Kpis;
  /**
   * `mergeChartSeries` over the per-board series, or `null` when there is
   * nothing to draw: no enabled chart block, or no board contributed a series.
   * Null rather than an empty series so the document can tell "no chart was
   * configured" from "the chart is configured and came back empty".
   */
  pooledChartSeries: ChartSeries | null;
};

/**
 * The chart options the WHOLE report renders from: the first *enabled* chart
 * block's. A config can legally carry several chart blocks, but the pooled
 * series is one series; picking the first enabled one matches what the v1
 * `exportReportPdf` did, so an existing report's export is unchanged.
 */
function firstEnabledChartOptions(
  config: ReportConfig,
): ChartBlockOptions | null {
  const block = config.blocks.find((b) => b.type === "chart" && b.enabled);
  return block && block.type === "chart" ? block.options : null;
}

export function deriveRenderData(
  payloads: BoardPayload[],
  peopleNames: Map<string, string>,
  config: ReportConfig,
): ReportRenderData {
  const chartOptions = firstEnabledChartOptions(config);

  const boards = payloads.map((p) =>
    buildReportBoardData(p, peopleNames, chartOptions),
  );
  const totals = poolKpis(boards.map((b) => b.kpis));

  const seriesList = boards
    .map((b) => b.chartSeries)
    .filter((s): s is ChartSeries => s !== null);

  return {
    boards,
    totals,
    pooledChartSeries:
      chartOptions && seriesList.length > 0
        ? mergeChartSeries(seriesList, chartOptions.maxCategories)
        : null,
  };
}
