// src/components/reports/ReportDocument.tsx
import type { ReportConfig } from "@/lib/reports/config";
import type { GroupSummary, Kpis, ReportModel } from "@/lib/reports/shape";
import type { ChartSeries } from "@/lib/reports/chart-data";
import { ChartBlock } from "./blocks/ChartBlock";
import { CoverBlock } from "./blocks/CoverBlock";
import { SummaryBlock } from "./blocks/SummaryBlock";
import { KpisBlock } from "./blocks/KpisBlock";
import { TableBlock } from "./blocks/TableBlock";
import { GroupSummariesBlock } from "./blocks/GroupSummariesBlock";
import { SpotlightBlock } from "./blocks/SpotlightBlock";
import { NotesBlock } from "./blocks/NotesBlock";
import { AppendixBlock } from "./blocks/AppendixBlock";

export type ReportDocumentProps = {
  config: ReportConfig;
  model: ReportModel;
  kpis: Kpis;
  groupSummaries: GroupSummary[];
  /**
   * REQUIRED, and `null` when the board has nothing chartable. Not optional on
   * purpose: both render paths (PreviewPane and exportReportPdf) must supply it
   * explicitly, or the preview and the PDF silently drift.
   */
  chartSeries: ChartSeries | null;
  boardName: string;
  orgName: string;
};

export function ReportDocument(props: ReportDocumentProps) {
  const {
    config,
    model,
    kpis,
    groupSummaries,
    chartSeries,
    boardName,
    orgName,
  } = props;
  return (
    <div className="r-doc">
      {config.blocks
        .filter((b) => b.enabled)
        .map((block, i) => {
          switch (block.type) {
            case "cover":
              return (
                <CoverBlock
                  key={i}
                  title={config.title}
                  boardName={boardName}
                  orgName={orgName}
                  options={block.options}
                />
              );
            case "summary":
              return <SummaryBlock key={i} options={block.options} />;
            case "kpis":
              return <KpisBlock key={i} kpis={kpis} />;
            case "chart":
              return (
                <ChartBlock
                  key={i}
                  series={
                    chartSeries ?? {
                      categories: [],
                      total: 0,
                      categoryName: "",
                      empty: true,
                    }
                  }
                  options={block.options}
                />
              );
            case "table":
              return (
                <TableBlock key={i} model={model} options={block.options} />
              );
            case "group_summaries":
              return <GroupSummariesBlock key={i} summaries={groupSummaries} />;
            case "spotlight":
              return (
                <SpotlightBlock key={i} model={model} options={block.options} />
              );
            case "notes":
              return <NotesBlock key={i} options={block.options} />;
            case "appendix":
              return <AppendixBlock key={i} model={model} />;
          }
        })}
    </div>
  );
}
