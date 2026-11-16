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
  hasDatedItems,
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
import type { BurnRow, FolderPayload, RollupRow } from "@/lib/folders/types";
import { SectionChrome } from "@/components/folders/edit/SectionChrome";

/**
 * Rows shown per board in "Needs attention" when the first-paint sample is
 * the folder's whole list (see `attentionComplete` below). Otherwise each
 * board's rows are read on demand, a page at a time.
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

/** What an absent section shows in Customize mode, so it can still be
 *  hidden or moved. Outside Customize mode the section is not drawn. */
function AbsentPlaceholder() {
  return (
    <p
      data-testid="section-placeholder"
      className="text-muted-foreground rounded-lg border border-dashed px-4 py-3 text-xs"
    >
      Nothing to show for this folder right now
    </p>
  );
}

export function OverviewTab({
  payload,
  burn: burnRows,
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
  /** The dense burn rows, expanded once from `payload.burnPacked` by
   *  CommandCenter. Null = not requested or failed. */
  burn: BurnRow[] | null;
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
    burnRows === null ? null : burnSeries(burnRows, stage, payload.todayISO);
  const anyDue = hasDatedItems(rows);
  // The first paint carries the folder's top 100 attention rows and the count
  // of ALL of them. Narrowing those rows to the selected board and stage HERE
  // is exact only when they are the whole list. When the folder has more
  // (or the count is unknown), filtering the sample would silently drop the
  // matching rows past the first 100, so nothing is taken from it: each board
  // reads its own rows, with the filter in the query, when it is expanded.
  // An absent count (older payloads) means the sample is complete.
  const attentionComplete =
    payload.attention !== null &&
    (payload.attentionTotal === undefined ||
      (payload.attentionTotal !== null &&
        payload.attentionTotal <= payload.attention.length));
  const attentionInScope =
    payload.attention === null
      ? null
      : !attentionComplete
        ? []
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
  // folder_burn_packed always carries imported_done, so this is known whenever
  // there are burn rows; it stays false only for an absent/empty series (and
  // for hand-built rows without the column).
  const importedKnown =
    burnRows?.some((r) => r.importedDone !== undefined) ?? false;
  const forecast =
    burn === null
      ? null
      : // The burn's completed line counts done items that have a due date.
        // Done items WITHOUT one are taken out of the target too, so what
        // remains is exactly the open items in scope.
        burnForecast(
          burn,
          burnScope.total - (burnScope.done - burnScope.doneDated),
          { importedKnown },
        );
  const milestones = nextMilestones(
    stages.filter((s) => stage === null || s.key === stage),
    payload.todayISO,
    3,
  );

  const panelFor = (s: LayoutSection): ReactNode => {
    if (s.type !== "builtin") return null; // widget sections: spec 2
    const kicker = kickerFor(sections, s.id);
    switch (s.panel) {
      case "kpis":
        return (
          <KpisPanel
            cards={s.props?.cards ?? []}
            rows={rows}
            todayISO={payload.todayISO}
            failed={payload.rollup === null}
            onRetry={onRetry}
            burn={burnRows}
            stage={stage}
            board={board}
            // Item lists are off while customizing: a click there edits.
            folderId={editing ? undefined : payload.folder.id}
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
            // With a board filter the Gap card is board-scoped but
            // this chart is folder-wide: state no gap at all then.
            gap={board === null ? burnScope.gap : null}
            stageBars={stageBars(stages)}
            todayISO={payload.todayISO}
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
            remote={
              attentionComplete
                ? undefined
                : { folderId: payload.folder.id, stage }
            }
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
            todayISO={payload.todayISO}
          />
        );
      case "load":
        // No dates, or the read was skipped: nothing to plot, so the section
        // is not drawn at all. A FAILED read shows the panel's Retry.
        if (!anyDue || payload.load.status === "skipped") return null;
        return (
          <LoadPanel
            kicker={kicker}
            title={s.title}
            grid={
              payload.load.status === "ready"
                ? loadGrid(
                    payload.load.rows,
                    payload.boards,
                    { stageKey: stage, boardId: board },
                    payload.todayISO,
                    payload.load.weeks,
                  )
                : null
            }
            failed={payload.load.status === "failed"}
            onRetry={onRetry}
          />
        );
      case "people":
        return (
          <PeoplePanel
            kicker={kicker}
            title={s.title}
            folderId={payload.folder.id}
            stage={stage}
            board={board}
            members={payload.members}
            onSeeAll={onSeeAllPeople}
          />
        );
      default:
        return null;
    }
  };
  // Sections that draw this render. In Customize mode every builtin section
  // draws (an absent one as a slim placeholder, so it can still be hidden or
  // moved); outside it, only those with something to show. Move up/down
  // steps over THESE, so it never lands next to a section that is not drawn.
  const nodes = new Map(sections.map((s) => [s.id, panelFor(s)]));
  const drawn = sections.filter((s) =>
    editing ? s.type === "builtin" : nodes.get(s.id) !== null,
  );
  // A move in the saved config swaps ADJACENT sections; to pass the absent
  // ones between `s` and its drawn neighbour, repeat it that many times.
  const move = (id: string, dir: "up" | "down") => {
    const at = drawn.findIndex((x) => x.id === id);
    const to = drawn[dir === "up" ? at - 1 : at + 1];
    if (at === -1 || to === undefined) return;
    const steps = Math.abs(
      sections.findIndex((x) => x.id === to.id) -
        sections.findIndex((x) => x.id === id),
    );
    for (let i = 0; i < steps; i++) onMoveSection?.(id, dir);
  };

  return (
    <div className="flex flex-col gap-4" data-print-root>
      <SectionGrid
        sections={sections}
        render={(s) => {
          const node = nodes.get(s.id) ?? null;
          // Outside Customize mode an absent section (node null) is not drawn
          // and SectionGrid lets its neighbour fill the row. In Customize mode
          // it keeps its chrome around a placeholder so it stays manageable.
          if (!editing || s.type !== "builtin") return node;
          return (
            <SectionChrome
              panel={s.panel}
              title={s.title}
              cards={s.panel === "kpis" ? (s.props?.cards ?? []) : undefined}
              index={drawn.findIndex((x) => x.id === s.id)}
              count={drawn.length}
              onHide={() => onHideSection?.(s.id)}
              onMoveUp={() => move(s.id, "up")}
              onMoveDown={() => move(s.id, "down")}
              onSetWidth={(w) => onSetSectionWidth?.(s.id, w)}
              onRename={(label) => onRenameSection?.(s.id, label)}
              onSetCards={
                s.panel === "kpis"
                  ? (cards) => onSetKpiCards?.(s.id, cards)
                  : undefined
              }
            >
              {node ?? <AbsentPlaceholder />}
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
