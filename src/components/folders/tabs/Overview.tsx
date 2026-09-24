"use client";

import type { ReactNode } from "react";
import { SectionGrid } from "@/components/folders/SectionGrid";
import { KpisPanel } from "@/components/folders/panels/KpisPanel";
import { BurnPanel } from "@/components/folders/panels/BurnPanel";
import { BoardStatusPanel } from "@/components/folders/panels/BoardStatusPanel";
import { AttentionPanel } from "@/components/folders/panels/AttentionPanel";
import { IntelligencePanel } from "@/components/folders/panels/IntelligencePanel";
import { MilestonesPanel } from "@/components/folders/panels/MilestonesPanel";
import {
  boardSummaries,
  burnSeries,
  nextMilestones,
} from "@/lib/folders/rollup";
import { stageKey, type StageSummary } from "@/lib/folders/stages";
import type { LayoutSection } from "@/lib/validations/folder-layout";
import type { FolderPayload, RollupRow } from "@/lib/folders/types";

/**
 * Rows shown in "Needs attention". `buildFolderPayload` asks the RPC for
 * `ATTENTION_LIMIT` (100) so the stage filter below classifies from a wide
 * enough pool; only the top 20 are rendered, and the caption says so.
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
}) {
  const boards = boardSummaries(rows, payload.boards, stages);
  const burn =
    payload.burn === null
      ? null
      : burnSeries(payload.burn, stage, payload.todayISO);
  const anyDue = rows.some((r) => r.minDue !== null || r.maxDue !== null);
  // The RPC returns the folder's top ATTENTION_LIMIT (100) rows by severity;
  // narrowing them to the selected stage happens here, on the client, so the
  // rendered list is a slice of a slice. The caption makes that visible
  // instead of quietly implying "this is everything".
  const attentionInScope =
    payload.attention === null
      ? null
      : payload.attention.filter(
          (a) =>
            stage === null ||
            (a.groupName !== null && stageKey(a.groupName) === stage),
        );
  const attention = attentionInScope?.slice(0, ATTENTION_SHOWN) ?? null;
  const attentionCaption =
    attentionInScope === null || attentionInScope.length === 0
      ? null
      : stage === null
        ? `Top ${Math.min(attentionInScope.length, ATTENTION_SHOWN)} across the folder`
        : `Top ${Math.min(attentionInScope.length, ATTENTION_SHOWN)} of ${attentionInScope.length} in this stage`;
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
          switch (s.panel) {
            case "kpis":
              return (
                <KpisPanel
                  cards={s.props?.cards ?? []}
                  rows={rows}
                  todayISO={payload.todayISO}
                  failed={payload.rollup === null}
                  onRetry={onRetry}
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
                  attention={attention}
                  caption={attentionCaption}
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
            default:
              return null;
          }
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
