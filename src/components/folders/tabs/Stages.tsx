"use client";

import { useState } from "react";
import { Kicker } from "@/components/ui/kicker";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { StackedStatusBar } from "@/components/folders/charts/StackedStatusBar";
import { StageMatrix } from "@/components/folders/charts/StageMatrix";
import { BurnChart } from "@/components/folders/charts/BurnChart";
import type { BurnMode } from "@/components/folders/charts/BurnChartInner";
import { burnSeries, carryOver, stageMatrix } from "@/lib/folders/rollup";
import type { StageState, StageSummary } from "@/lib/folders/stages";
import type { BurnRow, FolderBoardRef, RollupRow } from "@/lib/folders/types";
import { cn } from "@/lib/utils";

const STATE_LABEL: Record<StageState, string> = {
  complete: "COMPLETE",
  in_flight: "IN FLIGHT",
  upcoming: "UPCOMING",
};

function fmt(iso: string | null): string {
  if (iso === null) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function StagesTab({
  rows,
  allRows,
  stages,
  stage,
  burn,
  boards,
  todayISO,
  onSelectStage,
  onRetry,
}: {
  /**
   * Board-filtered (never stage-filtered — the cards ARE the stage selector,
   * so they must keep showing every stage) rows driving the stage cards, the
   * stage × board matrix and the carry-over count.
   */
  rows: RollupRow[];
  /**
   * Kept for interface/test-harness compatibility (the brief's contract and
   * `Stages.test.tsx` both pass it); nothing in this component currently
   * needs the folder-wide, board-unfiltered set once the caller applies the
   * board filter to `rows` — burn is the one thing that stays
   * folder/stage-wide regardless, but that's a `BurnRow` data-model
   * limitation (no `boardId` on burn rows), not a use of `allRows`.
   */
  allRows: RollupRow[];
  stages: StageSummary[];
  stage: string | null;
  burn: BurnRow[] | null;
  boards: FolderBoardRef[];
  todayISO: string;
  onSelectStage: (k: string | null) => void;
  onRetry: () => void;
}) {
  const [mode, setMode] = useState<BurnMode>("cumulative");
  const points = burn === null ? null : burnSeries(burn, stage, todayISO);
  const matrix = stageMatrix(rows);
  const carried = carryOver(rows, stages);
  const nameOf = new Map(boards.map((b) => [b.id, b.name]));
  void allRows;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {stages.map((s) => {
          const pct = s.total > 0 ? Math.round((s.done / s.total) * 100) : 0;
          return (
            <button
              key={s.key}
              type="button"
              data-testid="stage-card"
              aria-pressed={stage === s.key}
              onClick={() => onSelectStage(stage === s.key ? null : s.key)}
              className={cn(
                "bg-surface hover:border-border-hover card-lift flex flex-col gap-2 rounded-lg border p-4 text-left",
                stage === s.key && "border-border-bright",
              )}
            >
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm font-semibold">
                  <span
                    aria-hidden
                    className="size-2 rounded-full"
                    style={{ backgroundColor: s.color }}
                  />
                  {s.name}
                </span>
                <Kicker>{STATE_LABEL[s.state]}</Kicker>
              </div>
              <p className="text-muted-foreground font-mono text-xs">
                {fmt(s.minDue)} → {fmt(s.maxDue)} · {s.total} items · {pct}%
              </p>
              <StackedStatusBar
                mix={{
                  done: s.done,
                  inProgress: s.inProgress,
                  overdue: s.overdue,
                  notStarted: s.notStarted,
                }}
                label={s.name}
              />
              <p className="text-muted-foreground text-xs">
                {s.inProgress} in progress · {s.overdue} overdue ·{" "}
                {s.notStarted} not started
              </p>
              {s.onlyOnBoard ? (
                <p className="text-muted-foreground text-xs">
                  Only on {nameOf.get(s.onlyOnBoard) ?? s.onlyOnBoard}
                </p>
              ) : null}
            </button>
          );
        })}
      </div>

      <section className="bg-surface flex flex-col gap-3 rounded-lg border p-4">
        <div className="flex items-center justify-between">
          <div>
            <Kicker>02</Kicker>
            <h2 className="text-sm font-semibold">Burn by stage</h2>
          </div>
          <div role="radiogroup" aria-label="Chart mode" className="flex gap-1">
            {(["cumulative", "weekly"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                onClick={() => setMode(m)}
                className={cn(
                  "rounded-sm border px-2 py-0.5 text-xs",
                  mode === m
                    ? "border-border-bright text-foreground"
                    : "text-muted-foreground hover:border-border-hover",
                )}
              >
                {m === "cumulative" ? "Cumulative" : "Weekly"}
              </button>
            ))}
          </div>
        </div>
        {points === null ? (
          <EmptyState
            variant="inline"
            className="flex flex-col items-center gap-2"
          >
            This panel couldn&apos;t load.
            <Button type="button" size="sm" variant="outline" onClick={onRetry}>
              Retry
            </Button>
          </EmptyState>
        ) : points.length === 0 ? (
          <EmptyState variant="inline">
            Add due dates to see planned vs completed
          </EmptyState>
        ) : (
          <BurnChart points={points} mode={mode} />
        )}
      </section>

      <section className="bg-surface flex flex-col gap-3 rounded-lg border p-4">
        <div>
          <Kicker>03</Kicker>
          <h2 className="text-sm font-semibold">Stage × board</h2>
        </div>
        <StageMatrix
          boards={boards}
          stages={stages.map((s) => ({ key: s.key, name: s.name }))}
          cells={matrix}
          onSelectStage={onSelectStage}
        />
      </section>

      <p className="text-muted-foreground text-xs">
        <span className="font-medium">Carry-over:</span> {carried} open{" "}
        {carried === 1 ? "item" : "items"} in stages that are complete on
        another board.
      </p>
    </div>
  );
}
