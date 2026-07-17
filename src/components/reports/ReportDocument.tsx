// src/components/reports/ReportDocument.tsx
import type { ReportConfig } from "@/lib/reports/config";
import type { GroupSummary, Kpis, ReportModel } from "@/lib/reports/shape";
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
  boardName: string;
  orgName: string;
};

export function ReportDocument(props: ReportDocumentProps) {
  const { config, model, kpis, groupSummaries, boardName, orgName } = props;
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
