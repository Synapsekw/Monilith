"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { Kicker } from "@/components/ui/kicker";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusPill, type StatusColor } from "@/components/ui/status-pill";
import { KpiCard } from "@/components/folders/charts/KpiCard";
import { StackedStatusBar } from "@/components/folders/charts/StackedStatusBar";
import { BurnChart } from "@/components/folders/charts/BurnChart";
import type { BurnMode } from "@/components/folders/charts/BurnChartInner";
import {
  boardSummaries,
  burnSeries,
  computeKpis,
  nextMilestones,
} from "@/lib/folders/rollup";
import type { StageSummary } from "@/lib/folders/stages";
import type {
  AttentionReason,
  FolderPayload,
  RollupRow,
} from "@/lib/folders/types";
import { cn } from "@/lib/utils";

const REASON_COLOR: Record<AttentionReason, StatusColor> = {
  overdue: "red",
  blocked: "red",
  unassigned: "yellow",
  stale: "gray",
};

function Panel({
  kicker,
  title,
  children,
  className,
  id,
}: {
  kicker: string;
  title: string;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section
      id={id}
      className={cn(
        "bg-surface flex flex-col gap-3 rounded-lg border p-4",
        className,
      )}
    >
      <div>
        <Kicker>{kicker}</Kicker>
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function Failed({ onRetry }: { onRetry: () => void }) {
  return (
    <EmptyState variant="inline" className="flex flex-col items-center gap-2">
      This panel couldn&apos;t load.
      <Button type="button" size="sm" variant="outline" onClick={onRetry}>
        Retry
      </Button>
    </EmptyState>
  );
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function OverviewTab({
  payload,
  rows,
  stages,
  stage,
  widgets,
  onRetry,
}: {
  payload: FolderPayload;
  rows: RollupRow[];
  stages: StageSummary[];
  stage: string | null;
  widgets?: ReactNode;
  onRetry: () => void;
}) {
  const [mode, setMode] = useState<BurnMode>("cumulative");
  const k = computeKpis(rows, payload.todayISO);
  const boards = boardSummaries(rows, payload.boards, stages);
  const burn =
    payload.burn === null
      ? null
      : burnSeries(payload.burn, stage, payload.todayISO);
  const anyDue = rows.some((r) => r.minDue !== null || r.maxDue !== null);
  const attention =
    payload.attention === null
      ? null
      : payload.attention.filter(
          (a) =>
            stage === null ||
            (a.groupName !== null &&
              a.groupName.trim().toLowerCase() === stage),
        );
  const milestones = nextMilestones(
    stages.filter((s) => stage === null || s.key === stage),
    payload.todayISO,
    3,
  );

  return (
    <div className="flex flex-col gap-4" data-print-root>
      {payload.rollup === null ? (
        <Failed onRetry={onRetry} />
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <KpiCard
            label="Complete"
            value={k.donePct === null ? "—" : `${k.donePct}%`}
            badge={{ text: `${k.done} done`, color: "green" }}
            subFact={`${k.plannedByToday} planned by today`}
            progress={k.donePct}
            barColor="green"
          />
          <KpiCard
            label="Gap to plan"
            value={k.gap === null ? "—" : `${k.gap > 0 ? "+" : ""}${k.gap}`}
            badge={
              k.gap === null
                ? undefined
                : {
                    text: k.gap < 0 ? "behind" : "ahead",
                    color: k.gap < 0 ? "red" : "green",
                  }
            }
            subFact="done − planned"
            progress={
              k.gap === null || k.total === 0
                ? null
                : Math.min(100, (Math.abs(k.gap) / k.total) * 100)
            }
            barColor={k.gap !== null && k.gap < 0 ? "red" : "green"}
          />
          <KpiCard
            label="Overdue"
            value={String(k.overdue)}
            badge={
              k.oldestOverdueDays === null
                ? undefined
                : { text: `oldest ${k.oldestOverdueDays}d`, color: "red" }
            }
            subFact="open items past due"
            progress={k.total === 0 ? null : (k.overdue / k.total) * 100}
            barColor="red"
          />
          <KpiCard
            label="Due this week"
            value={String(k.dueThisWeek)}
            subFact={`${k.dueThisWeekNotStarted} not yet started`}
            progress={
              k.dueThisWeek === 0
                ? null
                : ((k.dueThisWeek - k.dueThisWeekNotStarted) / k.dueThisWeek) *
                  100
            }
            barColor="blue"
          />
          <KpiCard
            label="Blocked"
            value={String(k.blocked)}
            subFact="status blocked or stuck"
            progress={k.total === 0 ? null : (k.blocked / k.total) * 100}
            barColor="red"
          />
          <KpiCard
            label="Stale"
            value={String(k.stale)}
            subFact="untouched > 14 days"
            progress={k.total === 0 ? null : (k.stale / k.total) * 100}
            barColor="yellow"
          />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel
          kicker="02"
          title="Planned vs completed"
          className="lg:col-span-2"
        >
          <div
            role="radiogroup"
            aria-label="Chart mode"
            data-print-hide
            className="flex gap-1 self-end"
          >
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
          {burn === null ? (
            <Failed onRetry={onRetry} />
          ) : !anyDue || burn.length === 0 ? (
            <EmptyState variant="inline">
              Add due dates to see planned vs completed
            </EmptyState>
          ) : (
            <BurnChart points={burn} mode={mode} />
          )}
        </Panel>

        <Panel kicker="03" title="Status by board">
          {payload.rollup === null ? (
            <Failed onRetry={onRetry} />
          ) : (
            boards.map((b) => (
              <div key={b.id} className="flex flex-col gap-1">
                <div className="flex items-center justify-between text-xs">
                  <Link
                    href={`/boards/${b.id}`}
                    className="hover:text-foreground text-muted-foreground font-medium"
                  >
                    {b.name}
                  </Link>
                  <span className="text-muted-foreground font-mono tabular-nums">
                    {b.total}
                  </span>
                </div>
                <StackedStatusBar
                  mix={{
                    done: b.done,
                    inProgress: b.inProgress,
                    overdue: b.overdue,
                    notStarted: b.notStarted,
                  }}
                  label={b.name}
                />
              </div>
            ))
          )}
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel kicker="04" title="Needs attention" className="lg:col-span-2">
          {attention === null ? (
            <Failed onRetry={onRetry} />
          ) : attention.length === 0 ? (
            <EmptyState variant="inline">Nothing needs attention.</EmptyState>
          ) : (
            <ul className="divide-y">
              {attention.map((a) => (
                <li
                  key={a.itemId}
                  className="flex items-center gap-3 py-2 text-xs"
                >
                  <StatusPill
                    color={REASON_COLOR[a.reason]}
                    variant="soft"
                    className="w-24 justify-center"
                  >
                    {a.reason}
                  </StatusPill>
                  <Link
                    href={`/boards/${a.boardId}?item=${a.itemId}`}
                    className="hover:text-foreground min-w-0 flex-1 truncate font-medium"
                  >
                    {a.itemName}
                  </Link>
                  <span className="text-muted-foreground truncate">
                    {a.boardName}
                    {a.groupName ? ` · ${a.groupName.trim()}` : ""}
                  </span>
                  <span className="text-muted-foreground font-mono tabular-nums">
                    {a.reason} · {a.ageDays}d
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <div className="flex flex-col gap-4">
          {payload.briefs.length > 0 ? (
            <Panel kicker="05" title="Intelligence">
              <ul className="flex flex-col gap-3">
                {payload.briefs.map((b) => (
                  <li key={b.boardId} className="text-xs">
                    <p className="font-medium">{b.boardName}</p>
                    <p className="text-muted-foreground">{b.brief}</p>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
          <Panel kicker="06" title="Next milestones">
            {milestones.length === 0 ? (
              <EmptyState variant="inline">
                No upcoming stage end dates.
              </EmptyState>
            ) : (
              <ul className="flex flex-col gap-2">
                {milestones.map((m) => (
                  <li
                    key={m.stageKey}
                    data-testid="milestone"
                    className="flex items-center justify-between text-xs"
                  >
                    <span className="font-medium">{m.name}</span>
                    <span className="text-muted-foreground font-mono">
                      {fmtDate(m.endDate)} · {m.openBefore} open
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>

      {widgets ? (
        <div id="widgets" className="scroll-mt-20">
          {widgets}
        </div>
      ) : null}
    </div>
  );
}
