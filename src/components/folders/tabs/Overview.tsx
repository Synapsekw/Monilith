"use client";

import type { ReactNode } from "react";
import { SectionGrid } from "@/components/folders/SectionGrid";
import { KpisPanel } from "@/components/folders/panels/KpisPanel";
import { BurnPanel } from "@/components/folders/panels/BurnPanel";
import { BoardStatusPanel } from "@/components/folders/panels/BoardStatusPanel";
import { AttentionPanel } from "@/components/folders/panels/AttentionPanel";
import { LoadPanel } from "@/components/folders/panels/LoadPanel";
import { PeoplePanel } from "@/components/folders/panels/PeoplePanel";
import { IntelligencePanel } from "@/components/folders/panels/IntelligencePanel";
import { MilestonesPanel } from "@/components/folders/panels/MilestonesPanel";
import {
  boardSummaries,
  burnSeries,
  computeKpis,
  filterRows,
  nextMilestones,
} from "@/lib/folders/rollup";
import {
  attentionGroups,
  burnForecast,
  loadGrid,
  stageBars,
} from "@/lib/folders/tower";
import { stageKey, type StageSummary } from "@/lib/folders/stages";
import type { KpiKey, LayoutSection } from "@/lib/validations/folder-layout";
import type { FolderPayload, RollupRow } from "@/lib/folders/types";
import { SectionChrome } from "@/components/folders/edit/SectionChrome";

/**
 * Rows shown per board in "Needs attention". `buildFolderPayload` asks the RPC
 * for `ATTENTION_LIMIT` (100) so the stage filter below classifies from a wide
 * enough pool; each board expands to at most this many of them.
 */
const ATTENTION_SHOWN = 20;

/** Two-digit kicker from a section's position in `sections` — a folder that
 *  hides a panel (removes it from the config) doesn't leave a gap in the
 *  numbering; a panel that renders nothing at runtime (e.g. Intelligence with
 *  no briefs) keeps the kicker its config position implies. */
function kickerFor(sections: LayoutSection[], id: string): string {
  const i = sections.findIndex((s) => s.id === id);
  return String(i + 1).padStart(2, "0");
}

export function OverviewTab({
  payload,
  rows,
  stages,
  stage,
  board,
  sections,
  widgets,
  onRetry,
  editing = false,
  onHideSection,
  onMoveSection,
  onSetSectionWidth,
  onRenameSection,
  onSetKpiCards,
  onSeeAllPeople,
}: {
  payload: FolderPayload;
  rows: RollupRow[];
  stages: StageSummary[];
  stage: string | null;
  /** The active board filter, for the burn panel's scope caption only — the
   *  burn RPC has no board dimension. */
  board: string | null;
  sections: LayoutSection[];
  widgets?: ReactNode;
  onRetry: () => void;
  /** Customize mode (spec §6): when true, every builtin section renders
   *  wrapped in `SectionChrome` instead of bare. All five handlers are drafts
   *  on `useLayoutDraft` — nothing here reaches the server. */
  editing?: boolean;
  onHideSection?: (id: string) => void;
  onMoveSection?: (id: string, dir: "up" | "down") => void;
  onSetSectionWidth?: (id: string, w: number) => void;
  onRenameSection?: (id: string, label: string) => void;
  onSetKpiCards?: (id: string, cards: KpiKey[]) => void;
  /** Opens the People tab; omitted when the layout has none. */
  onSeeAllPeople?: () => void;
}) {
  const boards = boardSummaries(rows, payload.boards, stages);
  const burn =
    payload.burn === null
      ? null
      : burnSeries(payload.burn, stage, payload.todayISO);
  const anyDue = rows.some((r) => r.minDue !== null || r.maxDue !== null);
  // The RPC returns the folder's top ATTENTION_LIMIT (100) rows by severity;
  // narrowing them to the selected board and stage happens here, on the client.
  const attentionInScope =
    payload.attention === null
      ? null
      : payload.attention.filter(
          (a) =>
            (board === null || a.boardId === board) &&
            (stage === null ||
              (a.groupName !== null && stageKey(a.groupName) === stage)),
        );
  // One row per board. Counts come from the (already filtered) rollup rows, so
  // they are totals; each board expands to at most ATTENTION_SHOWN of the
  // RPC's top-N sample.
  const groups =
    attentionInScope === null
      ? null
      : attentionGroups(rows, attentionInScope, payload.todayISO).map((g) => ({
          ...g,
          items: g.items.slice(0, ATTENTION_SHOWN),
        }));
  const attentionCaption =
    groups === null || groups.length === 0
      ? null
      : "By board. Counts are totals; a board expands to its most urgent items.";
  // The burn series has no board dimension, so its reading is computed on the
  // chart's own scope: folder-wide, current stage. With no board filter this
  // is exactly `rows`, so the reading's gap equals the Gap card; with one, the
  // panel's "Scope: All boards" note labels the difference.
  const burnScope = computeKpis(
    payload.rollup === null
      ? rows
      : filterRows(payload.rollup, { stageKey: stage, boardId: null }),
    payload.todayISO,
  );
  // Pre-migration folder_burn has no imported_done column: unknown, not 0.
  const importedKnown =
    payload.burn?.some((r) => r.importedDone !== undefined) ?? false;
  const forecast =
    burn === null
      ? null
      : burnForecast(burn, burnScope.total, { importedKnown });
  const milestones = nextMilestones(
    stages.filter((s) => stage === null || s.key === stage),
    payload.todayISO,
    3,
  );

  return (
    <div className="flex flex-col gap-4" data-print-root>
      <SectionGrid
        sections={sections}
        render={(s) => {
          if (s.type !== "builtin") return null; // widget sections: spec 2
          const kicker = kickerFor(sections, s.id);
          const node = (() => {
            switch (s.panel) {
              case "kpis":
                return (
                  <KpisPanel
                    cards={s.props?.cards ?? []}
                    rows={rows}
                    todayISO={payload.todayISO}
                    failed={payload.rollup === null}
                    onRetry={onRetry}
                    burn={payload.burn}
                    stage={stage}
                    board={board}
                  />
                );
              case "burn":
                return (
                  <BurnPanel
                    kicker={kicker}
                    title={s.title}
                    board={board}
                    burn={burn}
                    anyDue={anyDue}
                    onRetry={onRetry}
                    forecast={forecast}
                    gap={burnScope.gap}
                    stageBars={stageBars(stages)}
                  />
                );
              case "boardStatus":
                return (
                  <BoardStatusPanel
                    kicker={kicker}
                    title={s.title}
                    boards={boards}
                    failed={payload.rollup === null}
                    onRetry={onRetry}
                  />
                );
              case "attention":
                return (
                  <AttentionPanel
                    kicker={kicker}
                    title={s.title}
                    attention={attentionInScope}
                    caption={attentionCaption}
                    groups={groups}
                    onRetry={onRetry}
                  />
                );
              case "intelligence":
                return payload.briefs.length > 0 ? (
                  <IntelligencePanel
                    kicker={kicker}
                    title={s.title}
                    briefs={payload.briefs}
                  />
                ) : null;
              case "milestones":
                return (
                  <MilestonesPanel
                    kicker={kicker}
                    title={s.title}
                    milestones={milestones}
                  />
                );
              case "load":
                // No dates or no load rows: nothing to plot, so the section is
                // not drawn at all.
                return anyDue && payload.load !== null ? (
                  <LoadPanel
                    kicker={kicker}
                    title={s.title}
                    grid={loadGrid(
                      payload.load,
                      payload.boards,
                      { stageKey: stage, boardId: board },
                      payload.todayISO,
                    )}
                    failed={false}
                    onRetry={onRetry}
                  />
                ) : null;
              case "people":
                return (
                  <PeoplePanel
                    kicker={kicker}
                    title={s.title}
                    folderId={payload.folder.id}
                    stage={stage}
                    members={payload.members}
                    onSeeAll={onSeeAllPeople}
                  />
                );
              default:
                return null;
            }
          })();
          // An absent section (node null) stays absent in Customize mode too:
          // no empty chrome box, and SectionGrid lets its neighbour fill the row.
          if (!editing || node === null) return node;
          const index = sections.findIndex((x) => x.id === s.id);
          return (
            <SectionChrome
              panel={s.panel}
              title={s.title}
              cards={s.panel === "kpis" ? (s.props?.cards ?? []) : undefined}
              index={index}
              count={sections.length}
              onHide={() => onHideSection?.(s.id)}
              onMoveUp={() => onMoveSection?.(s.id, "up")}
              onMoveDown={() => onMoveSection?.(s.id, "down")}
              onSetWidth={(w) => onSetSectionWidth?.(s.id, w)}
              onRename={(label) => onRenameSection?.(s.id, label)}
              onSetCards={
                s.panel === "kpis"
                  ? (cards) => onSetKpiCards?.(s.id, cards)
                  : undefined
              }
            >
              {node}
            </SectionChrome>
          );
        }}
      />
      {widgets ? (
        <div id="widgets" className="scroll-mt-20">
          {widgets}
        </div>
      ) : null}
    </div>
  );
}
