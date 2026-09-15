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
import { HeaderActions } from "./HeaderActions";
import { OverviewTab } from "./tabs/Overview";
import { StagesTab } from "./tabs/Stages";
import { BoardsTab } from "./tabs/Boards";
import { PeopleTab, peopleFromWorkload } from "./tabs/People";
import { OVERLOAD_THRESHOLD } from "@/components/folders/charts/WorkloadBars";

export type CommandCenterProps = {
  payload: FolderPayload;
  widgets?: ReactNode;
};

/**
 * The folder command center (spec §5). Everything below the header derives
 * from `payload` in client state; tab/stage/board live in the URL via
 * history.replaceState (0 server round-trips per interaction, gotcha-09).
 * `onRetry` is the one legitimate server call: a failed RPC panel re-runs the
 * page's RSC render, which is DIFFERENT data being requested, not a refetch
 * of state the client already has.
 */
export function CommandCenter({ payload, widgets }: CommandCenterProps) {
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
  // Board-only filter (ignores the stage filter) for the Stages tab: its
  // cards, matrix and carry-over must keep showing EVERY stage — they're the
  // stage selector — but should still honour the board filter, same as
  // Overview's KPIs/board list do via `rows` above.
  const stageTabRows = useMemo(
    () => filterRows(rollup, { stageKey: null, boardId: board }),
    [rollup, board],
  );
  const stageTabStages = useMemo(
    () => buildStages(stageTabRows, payload.todayISO),
    [stageTabRows, payload.todayISO],
  );
  const stageTabBoards = useMemo(
    () =>
      board ? payload.boards.filter((b) => b.id === board) : payload.boards,
    [payload.boards, board],
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
      {/* Print-only: PageHeader itself sits outside [data-print-root] and is
          hidden by the print stylesheet's `body * { visibility: hidden }`, so
          the exported PDF would otherwise say nothing about which folder it
          is. `hidden` keeps this out of normal layout and the a11y tree;
          `@media print` flips it to a positioned block above the print root. */}
      <p
        data-print-title
        aria-hidden="true"
        className="font-heading hidden text-lg font-semibold tracking-tight"
      >
        {payload.folder.name}
      </p>
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
        actions={<HeaderActions folderId={payload.folder.id} tab={tab} />}
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
              rows={stageTabRows}
              allRows={rollup}
              stages={stageTabStages}
              stage={stage}
              burn={payload.burn}
              boards={stageTabBoards}
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
