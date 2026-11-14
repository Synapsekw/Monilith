import { Fragment, type ReactNode } from "react";
import { KpiCard } from "@/components/folders/charts/KpiCard";
import type { StatusColor } from "@/components/ui/status-pill";
import { computeKpis, type Kpis } from "@/lib/folders/rollup";
import { kpiTrends, trendChange, type Trend } from "@/lib/folders/tower";
import type { KpiKey } from "@/lib/validations/folder-layout";
import type { BurnRow, RollupRow } from "@/lib/folders/types";
import { Failed } from "./Panel";

type TrendProp = Parameters<typeof KpiCard>[0]["trend"];

const LABEL: Record<KpiKey, string> = {
  complete: "Complete",
  gap: "Gap to plan",
  overdue: "Overdue",
  dueThisWeek: "Due this week",
  blocked: "Blocked",
  stale: "Stale",
};

const TREND_COLOR: Partial<Record<KpiKey, StatusColor>> = {
  complete: "green",
  gap: "red",
  overdue: "red",
  dueThisWeek: "blue",
};

function trendProp(key: KpiKey, t: Trend | undefined): TrendProp {
  if (!t || t.points.length < 2) return undefined;
  const change = trendChange(key, t);
  const span =
    t.kind === "bars"
      ? `next ${t.points.length} weeks`
      : `last ${t.points.length} weeks`;
  return {
    points: t.points,
    kind: t.kind,
    color: TREND_COLOR[key] ?? "blue",
    label: `${LABEL[key]}, ${span}: ${t.points.join(", ")}`,
    change: { text: change.text, color: change.tone },
  };
}

/** A card with nothing to say is drawn as a chip instead. Complete and a gap
 *  of exactly zero stay cards: 0% and "on plan" are information. */
const IS_ZERO: Record<KpiKey, (k: Kpis) => boolean> = {
  complete: (k) => k.donePct === null,
  gap: (k) => k.gap === null,
  overdue: (k) => k.overdue === 0,
  dueThisWeek: (k) => k.dueThisWeek === 0,
  blocked: (k) => k.blocked === 0,
  stale: (k) => k.stale === 0,
};

const CHIP_VALUE: Record<KpiKey, (k: Kpis) => string> = {
  complete: () => "—",
  gap: () => "—",
  overdue: (k) => String(k.overdue),
  dueThisWeek: (k) => String(k.dueThisWeek),
  blocked: (k) => String(k.blocked),
  stale: (k) => String(k.stale),
};

const CARD: Record<KpiKey, (k: Kpis, trend: TrendProp) => ReactNode> = {
  complete: (k, trend) => (
    <KpiCard
      label={LABEL.complete}
      value={k.donePct === null ? "—" : `${k.donePct}%`}
      badge={{ text: `${k.done} done`, color: "green" }}
      subFact={`${k.plannedByToday} planned by today`}
      progress={k.donePct}
      barColor="green"
      trend={trend}
    />
  ),
  gap: (k, trend) => (
    <KpiCard
      label={LABEL.gap}
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
      trend={trend}
    />
  ),
  overdue: (k, trend) => (
    <KpiCard
      label={LABEL.overdue}
      value={String(k.overdue)}
      badge={
        k.oldestOverdueDays === null
          ? undefined
          : { text: `oldest ${k.oldestOverdueDays}d`, color: "red" }
      }
      subFact="open items past due"
      progress={k.total === 0 ? null : (k.overdue / k.total) * 100}
      barColor="red"
      trend={trend}
    />
  ),
  dueThisWeek: (k, trend) => (
    <KpiCard
      label={LABEL.dueThisWeek}
      value={String(k.dueThisWeek)}
      subFact={`${k.dueThisWeekNotStarted} not yet started`}
      progress={
        k.dueThisWeek === 0
          ? null
          : ((k.dueThisWeek - k.dueThisWeekNotStarted) / k.dueThisWeek) * 100
      }
      barColor="blue"
      trend={trend}
    />
  ),
  blocked: (k) => (
    <KpiCard
      label={LABEL.blocked}
      value={String(k.blocked)}
      subFact="status blocked or stuck"
      progress={k.total === 0 ? null : (k.blocked / k.total) * 100}
      barColor="red"
    />
  ),
  stale: (k) => (
    <KpiCard
      label={LABEL.stale}
      value={String(k.stale)}
      subFact="untouched > 14 days"
      progress={k.total === 0 ? null : (k.stale / k.total) * 100}
      barColor="yellow"
    />
  ),
};

/**
 * The KPI row. `cards` is the folder's chosen subset, in its chosen order.
 * Cards with a value get a trend when the burn rows are on the page and no
 * board filter is set (the burn RPC has no board dimension); cards at zero
 * collapse into one row of chips so they stop competing for attention.
 */
export function KpisPanel({
  cards,
  rows,
  todayISO,
  failed,
  onRetry,
  burn = null,
  stage = null,
  board = null,
}: {
  cards: KpiKey[];
  rows: RollupRow[];
  todayISO: string;
  failed: boolean;
  onRetry: () => void;
  burn?: BurnRow[] | null;
  stage?: string | null;
  board?: string | null;
}) {
  const k = computeKpis(rows, todayISO);
  if (failed) return <Failed onRetry={onRetry} />;
  // Each trend ENDS on the value its card shows (kpiTrends' agreement rule),
  // so a pill can never contradict the number above it.
  const trends =
    burn === null || board !== null
      ? {}
      : kpiTrends(burn, stage, todayISO, k.total, {
          complete: k.donePct,
          gap: k.gap,
          overdue: k.overdue,
          dueThisWeek: k.dueThisWeek,
        });
  const live = cards.filter((key) => !IS_ZERO[key](k));
  const quiet = cards.filter((key) => IS_ZERO[key](k));
  const anyDue = rows.some((r) => r.minDue !== null || r.maxDue !== null);
  return (
    <div className="flex flex-col gap-3">
      {live.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {live.map((key) => (
            <Fragment key={key}>
              {CARD[key](k, trendProp(key, trends[key]))}
            </Fragment>
          ))}
        </div>
      ) : null}
      {quiet.length > 0 || !anyDue ? (
        <ul
          aria-label="Nothing to report"
          className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs"
        >
          {quiet.map((key) => (
            <li
              key={key}
              data-testid="kpi-chip"
              className="inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 font-mono"
            >
              <span>{LABEL[key]}</span>
              <span className="sr-only">: </span>
              <span className="tabular-nums">{CHIP_VALUE[key](k)}</span>
            </li>
          ))}
          {!anyDue && rows.length > 0 ? (
            <li className="inline-flex items-center rounded-sm border px-2 py-0.5 font-mono">
              No due dates set
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
