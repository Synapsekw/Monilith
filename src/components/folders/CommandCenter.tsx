"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { EmptyState } from "@/components/ui/empty-state";
import { MetaChip } from "@/components/ui/meta-chip";
import { PageHeader } from "@/components/ui/page-header";
import { buildStages } from "@/lib/folders/stages";
import { filterRows } from "@/lib/folders/rollup";
import type { FolderPayload, WorkloadRow } from "@/lib/folders/types";
import { useCommandCenterState } from "./command-center-state";
import { TabStrip } from "./TabStrip";
import { FilterBar } from "./FilterBar";
import { OverviewTab } from "./tabs/Overview";
import { StagesTab } from "./tabs/Stages";
import { BoardsTab } from "./tabs/Boards";
import { PeopleTab, peopleFromWorkload } from "./tabs/People";
import { OVERLOAD_THRESHOLD } from "@/components/folders/charts/WorkloadBars";

export type CommandCenterProps = {
  payload: FolderPayload;
  widgets?: ReactNode;
  headerActions?: ReactNode;
};

/**
 * The folder command center (spec §5). Everything below the header derives
 * from `payload` in client state; tab/stage/board live in the URL via
 * history.replaceState (0 server round-trips per interaction, gotcha-09).
 * `onRetry` is the one legitimate server call: a failed RPC panel re-runs the
 * page's RSC render, which is DIFFERENT data being requested, not a refetch
 * of state the client already has.
 */
export function CommandCenter({
  payload,
  widgets,
  headerActions,
}: CommandCenterProps) {
  const router = useRouter();
  const { tab, stage, board, setTab, setStage, setBoard } =
    useCommandCenterState();
  const rollup = useMemo(() => payload.rollup ?? [], [payload.rollup]);
  const stages = useMemo(
    () => buildStages(rollup, payload.todayISO),
    [rollup, payload.todayISO],
  );
  const rows = useMemo(
    () => filterRows(rollup, { stageKey: stage, boardId: board }),
    [rollup, stage, board],
  );
  const itemCount = rows.reduce((s, r) => s + r.total, 0);
  const empty = payload.boards.length === 0;
  const generated = new Date(payload.generatedAt);
  const [workload, setWorkload] = useState<WorkloadRow[] | null>(null);
  const onWorkload = useCallback(
    (rows: WorkloadRow[]) => setWorkload(rows),
    [],
  );
  const people =
    workload === null
      ? null
      : peopleFromWorkload(workload, stage, payload.members);
  const counts = {
    stages: stages.length,
    boards: payload.boards.length,
    people: people === null ? null : people.length,
    overloaded:
      people === null
        ? 0
        : people.filter((p) => p.open > OVERLOAD_THRESHOLD).length,
  };

  return (
    <div className="flex flex-col gap-2 p-4 md:p-6">
      <PageHeader
        kicker="Command center"
        title={payload.folder.name}
        description={
          <MetaChip label="Snapshot">
            {Number.isNaN(generated.getTime())
              ? payload.generatedAt
              : generated.toLocaleString()}{" "}
            · live
          </MetaChip>
        }
        actions={headerActions}
      />
      <TabStrip tab={tab} counts={counts} disabled={empty} onChange={setTab} />
      {empty ? (
        <EmptyState className="mt-4">
          <span className="block">Add boards to this folder</span>
          <span className="text-xs">
            Use a board&apos;s ⋯ menu → Move to folder.
          </span>
        </EmptyState>
      ) : (
        <>
          <FilterBar
            stages={stages}
            boards={payload.boards}
            stage={stage}
            board={board}
            itemCount={itemCount}
            onStage={setStage}
            onBoard={setBoard}
          />
          {tab === "overview" ? (
            <OverviewTab
              payload={payload}
              rows={rows}
              stages={buildStages(rows, payload.todayISO)}
              stage={stage}
              widgets={widgets}
              onRetry={() => router.refresh()}
            />
          ) : tab === "stages" ? (
            <StagesTab
              rows={rows}
              allRows={rollup}
              stages={stages}
              stage={stage}
              burn={payload.burn}
              boards={payload.boards}
              todayISO={payload.todayISO}
              onSelectStage={setStage}
              onRetry={() => router.refresh()}
            />
          ) : tab === "boards" ? (
            <BoardsTab
              rows={rows}
              boards={
                board
                  ? payload.boards.filter((b) => b.id === board)
                  : payload.boards
              }
              stages={stages}
            />
          ) : (
            <PeopleTab
              folderId={payload.folder.id}
              stage={stage}
              members={payload.members}
              onWorkload={onWorkload}
            />
          )}
        </>
      )}
    </div>
  );
}
