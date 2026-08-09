// src/components/reports/ReportDocument.tsx
import { Fragment, type ReactNode } from "react";
import type { BoardScope, ReportConfig } from "@/lib/reports/config";
import { blockBoardIds } from "@/lib/reports/config";
import type { Kpis } from "@/lib/reports/shape";
import type { ChartSeries } from "@/lib/reports/chart-data";
import type { ReportBoardData } from "@/lib/reports/aggregate";
import { ChartBlock } from "./blocks/ChartBlock";
import { CoverBlock } from "./blocks/CoverBlock";
import { SummaryBlock } from "./blocks/SummaryBlock";
import { KpisBlock } from "./blocks/KpisBlock";
import { TableBlock } from "./blocks/TableBlock";
import { GroupSummariesBlock } from "./blocks/GroupSummariesBlock";
import { SpotlightBlock } from "./blocks/SpotlightBlock";
import { NotesBlock } from "./blocks/NotesBlock";
import { AppendixBlock } from "./blocks/AppendixBlock";

/** What ChartBlock renders as its own empty state. */
const EMPTY_SERIES: ChartSeries = {
  categories: [],
  total: 0,
  categoryName: "",
  empty: true,
};

export type ReportDocumentProps = {
  config: ReportConfig;
  /** The report's bound boards, in bound order. May be 0, 1 or N. */
  boards: ReportBoardData[];
  /** `poolKpis` over `boards` — what the KPI block prints. */
  totals: Kpis;
  /**
   * `mergeChartSeries` over the boards' series, and `null` when nothing is
   * chartable. REQUIRED, not optional, on purpose: both render paths
   * (PreviewPane and exportReportPdf) must supply it explicitly, or the preview
   * and the PDF silently drift.
   */
  pooledChartSeries: ChartSeries | null;
  /** What the report covers — a board name, or a portfolio/selection name. */
  scopeLabel: string;
  /** Boards the viewer cannot read. Disclosed on the page, never hidden. */
  omittedBoardCount: number;
  orgName: string;
};

export function ReportDocument(props: ReportDocumentProps) {
  const {
    config,
    boards,
    totals,
    pooledChartSeries,
    scopeLabel,
    omittedBoardCount,
    orgName,
  } = props;

  const boardIds = boards.map((b) => b.boardId);
  // Headings are keyed on how many boards the REPORT binds, not how many a
  // given block targets: with one board there is nothing to disambiguate and
  // the output must stay byte-for-byte what v1 printed; with several, even a
  // block pinned to one of them has to say which one.
  const multi = boards.length > 1;

  const targets = (scope: BoardScope): ReportBoardData[] => {
    const ids = new Set(blockBoardIds(scope, boardIds));
    return boards.filter((b) => ids.has(b.boardId));
  };

  /**
   * Render a board-specific block once per board it targets.
   *
   * Zero targets renders NOTHING — a report over no readable boards (or a block
   * pinned to a board that was since unbound) must not leave a labelled section
   * standing over empty space.
   */
  const perBoard = (
    scope: BoardScope,
    render: (board: ReportBoardData) => ReactNode,
  ): ReactNode => {
    const list = targets(scope);
    if (list.length === 0) return null;
    if (!multi) return render(list[0]);
    return (
      <div className="r-board-set">
        {list.map((b) => (
          <div className="r-board" key={b.boardId}>
            <div className="r-board-head">
              <span className="r-board-head-lbl">Board</span>
              <span className="r-board-name">{b.boardName}</span>
            </div>
            {render(b)}
          </div>
        ))}
      </div>
    );
  };

  const disclosure =
    omittedBoardCount > 0 ? (
      <p className="r-omitted">
        {omittedBoardCount} {omittedBoardCount === 1 ? "board" : "boards"}{" "}
        omitted — no access
      </p>
    ) : null;
  // The disclosure belongs directly under the cover. With the cover switched
  // off it moves to the top of the document rather than disappearing.
  const hasCover = config.blocks.some((b) => b.enabled && b.type === "cover");

  return (
    <div className="r-doc">
      {hasCover ? null : disclosure}
      {config.blocks
        .filter((b) => b.enabled)
        .map((block, i) => {
          switch (block.type) {
            case "cover":
              return (
                <Fragment key={i}>
                  <CoverBlock
                    title={config.title}
                    scopeLabel={scopeLabel}
                    boardCount={boards.length}
                    orgName={orgName}
                    options={block.options}
                  />
                  {disclosure}
                </Fragment>
              );
            case "summary":
              return <SummaryBlock key={i} options={block.options} />;
            case "kpis":
              // KPIs pool across every bound board by design — no boardScope.
              return <KpisBlock key={i} kpis={totals} />;
            case "chart": {
              const scope = block.options.boardScope;
              const series =
                scope.mode === "all"
                  ? pooledChartSeries
                  : (targets(scope)[0]?.chartSeries ?? null);
              return (
                <ChartBlock
                  key={i}
                  series={series ?? EMPTY_SERIES}
                  options={block.options}
                />
              );
            }
            case "table":
              return (
                <Fragment key={i}>
                  {perBoard(block.options.boardScope, (b) => (
                    <TableBlock model={b.model} options={block.options} />
                  ))}
                </Fragment>
              );
            case "group_summaries":
              return (
                <Fragment key={i}>
                  {perBoard(block.options.boardScope, (b) => (
                    <GroupSummariesBlock summaries={b.groupSummaries} />
                  ))}
                </Fragment>
              );
            case "spotlight":
              // Spotlight carries no boardScope: its item ids are global, and
              // SpotlightBlock renders nothing for a board holding none of
              // them. Running it over every board therefore surfaces exactly
              // the boards that own a spotlighted item — and never an empty
              // heading, which is why this one is not wrapped in `perBoard`.
              return (
                <Fragment key={i}>
                  {boards.map((b) => (
                    <SpotlightBlock
                      key={b.boardId}
                      model={b.model}
                      options={block.options}
                    />
                  ))}
                </Fragment>
              );
            case "notes":
              return <NotesBlock key={i} options={block.options} />;
            case "appendix":
              return (
                <Fragment key={i}>
                  {perBoard(block.options.boardScope, (b) => (
                    <AppendixBlock model={b.model} />
                  ))}
                </Fragment>
              );
          }
        })}
    </div>
  );
}
