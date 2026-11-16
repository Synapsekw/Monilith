"use client";

import { Fragment, useState, type ReactNode } from "react";
import { KpiCard } from "@/components/folders/charts/KpiCard";
import type { StatusColor } from "@/components/ui/status-pill";
import { computeKpis, type Kpis } from "@/lib/folders/rollup";
import { kpiTrends, trendChange, type Trend } from "@/lib/folders/tower";
import type { KpiKey } from "@/lib/validations/folder-layout";
import type { BurnRow, KpiItemKind, RollupRow } from "@/lib/folders/types";
import { KpiDrilldown } from "./KpiDrilldown";
import { Failed } from "./Panel";

type TrendProp = Parameters<typeof KpiCard>[0]["trend"];
type ActionProp = Parameters<typeof KpiCard>[0]["action"];

/**
 * The item list behind each card: which `folder_kpi_items` list it opens,
 * the number on the card that list's total must equal, and what the items
 * are called. "Gap to plan" has no entry: it is a difference of two counts,
 * not a set of items.
 */
export const DRILL: Partial<
  Record<
    KpiKey,
    { kind: KpiItemKind; count: (k: Kpis) => number; noun: string }
  >
> = {
  complete: { kind: "done", count: (k) => k.done, noun: "done" },
  overdue: { kind: "overdue", count: (k) => k.overdue, noun: "overdue" },
  dueThisWeek: {
    kind: "due_this_week",
    count: (k) => k.dueThisWeek,
    noun: "due this week",
  },
  blocked: { kind: "blocked", count: (k) => k.blocked, noun: "blocked" },
  stale: { kind: "stale", count: (k) => k.stale, noun: "stale" },
};

const DRILL_ID = "kpi-items";

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

/** The sparkline colour. The gap's follows the sign of the CURRENT gap
 *  (ahead or on plan: the positive token; behind: red); the card's text
 *  already says "ahead" or "behind", so colour is never the only signal. */
export function trendColor(key: KpiKey, k: Kpis): StatusColor {
  if (key === "gap") return k.gap !== null && k.gap < 0 ? "red" : "green";
  return TREND_COLOR[key] ?? "blue";
}

function trendProp(
  key: KpiKey,
  t: Trend | undefined,
  color: StatusColor,
): TrendProp {
  if (!t || t.points.length < 2) return undefined;
  const change = trendChange(key, t);
  const span =
    t.kind === "bars"
      ? `next ${t.points.length} weeks`
      : `last ${t.points.length} weeks`;
  return {
    points: t.points,
    kind: t.kind,
    color,
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

const CARD: Record<
  KpiKey,
  (k: Kpis, trend: TrendProp, action?: ActionProp) => ReactNode
> = {
  complete: (k, trend, action) => (
    <KpiCard
      label={LABEL.complete}
      value={k.donePct === null ? "—" : `${k.donePct}%`}
      badge={{ text: `${k.done} done`, color: "green" }}
      subFact={`${k.plannedByToday} planned by today`}
      progress={k.donePct}
      barColor="green"
      trend={trend}
      action={action}
    />
  ),
  gap: (k, trend, action) => (
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
      subFact="dated items: done − planned"
      progress={
        k.gap === null || k.total === 0
          ? null
          : Math.min(100, (Math.abs(k.gap) / k.total) * 100)
      }
      barColor={k.gap !== null && k.gap < 0 ? "red" : "green"}
      trend={trend}
      action={action}
    />
  ),
  overdue: (k, trend, action) => (
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
      action={action}
    />
  ),
  dueThisWeek: (k, trend, action) => (
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
      action={action}
    />
  ),
  blocked: (k, _trend, action) => (
    <KpiCard
      label={LABEL.blocked}
      value={String(k.blocked)}
      subFact="status blocked or stuck"
      progress={k.total === 0 ? null : (k.blocked / k.total) * 100}
      barColor="red"
      action={action}
    />
  ),
  stale: (k, _trend, action) => (
    <KpiCard
      label={LABEL.stale}
      value={String(k.stale)}
      subFact="untouched > 14 days"
      progress={k.total === 0 ? null : (k.stale / k.total) * 100}
      barColor="yellow"
      action={action}
    />
  ),
};

/**
 * The KPI row. `cards` is the folder's chosen subset, in its chosen order.
 * Cards with a value get a trend when the burn rows are on the page and no
 * board filter is set (the burn RPC has no board dimension); cards at zero
 * collapse into one row of chips so they stop competing for attention.
 *
 * With `folderId`, a card that counts items opens the list of those items
 * under the row, in place: no navigation, and nothing is read until the
 * click (then one bounded page per request, `getFolderKpiItems`). The list
 * is scoped to the same stage and board as the card.
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
  folderId,
}: {
  cards: KpiKey[];
  rows: RollupRow[];
  todayISO: string;
  failed: boolean;
  onRetry: () => void;
  burn?: BurnRow[] | null;
  stage?: string | null;
  board?: string | null;
  /** Enables the item lists. Omitted (Customize mode, tests): plain cards. */
  folderId?: string;
}) {
  const [opened, setOpened] = useState<KpiKey | null>(null);
  const k = computeKpis(rows, todayISO);
  if (failed) return <Failed onRetry={onRetry} />;
  // Each trend ENDS on the value its card shows (kpiTrends' agreement rule),
  // so a pill can never contradict the number above it.
  const trends =
    burn === null || board !== null
      ? {}
      : kpiTrends(
          burn,
          stage,
          todayISO,
          k.total,
          {
            complete: k.donePct,
            gap: k.gap,
            overdue: k.overdue,
            dueThisWeek: k.dueThisWeek,
          },
          // The burn's completed line counts dated items only; the Complete
          // card counts every done item.
          k.done - k.doneDated,
        );
  const anyDue = rows.some((r) => r.minDue !== null || r.maxDue !== null);
  const live = cards.filter((key) => !IS_ZERO[key](k));
  // With no dated items the gap is undefined, and the "No due dates set" chip
  // already says why, so no "Gap to plan —" chip beside it.
  const quiet = cards.filter(
    (key) => IS_ZERO[key](k) && !(key === "gap" && !anyDue),
  );
  // A card that dropped to zero (a filter change) is a chip now: its list
  // closes with it.
  const open =
    folderId !== undefined && opened !== null && live.includes(opened)
      ? opened
      : null;
  const openDrill = open === null ? undefined : DRILL[open];
  const actionFor = (key: KpiKey): ActionProp => {
    const d = DRILL[key];
    if (folderId === undefined || d === undefined) return undefined;
    const n = d.count(k);
    return {
      label: `${open === key ? "Hide" : "Show"} the ${n} ${d.noun} ${n === 1 ? "item" : "items"}`,
      expanded: open === key,
      controls: DRILL_ID,
      onToggle: () => setOpened(open === key ? null : key),
    };
  };
  return (
    <div className="flex flex-col gap-3">
      {live.length > 0 ? (
        // At lg and up the cards flow into ONE row of equal implicit columns,
        // so any count from 1 to 6 fills it (a card that became a chip used to
        // leave a hole in a fixed 6-column grid; auto-fit wrapped 5 + 1 below
        // ~1,020px). Below lg: 3-up from sm, 2-up on phones.
        <div
          data-testid="kpi-cards"
          className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:auto-cols-fr lg:grid-flow-col lg:grid-cols-none"
        >
          {live.map((key) => (
            <Fragment key={key}>
              {CARD[key](
                k,
                trendProp(key, trends[key], trendColor(key, k)),
                actionFor(key),
              )}
            </Fragment>
          ))}
        </div>
      ) : null}
      {folderId !== undefined && open !== null && openDrill !== undefined ? (
        <KpiDrilldown
          // A new list per card and scope: paging restarts from the top.
          key={`${open}:${board ?? ""}:${stage ?? ""}`}
          id={DRILL_ID}
          folderId={folderId}
          kind={openDrill.kind}
          title={LABEL[open]}
          expected={openDrill.count(k)}
          stage={stage}
          board={board}
          todayISO={todayISO}
          onClose={() => setOpened(null)}
        />
      ) : null}
      {quiet.length > 0 || (!anyDue && k.total > 0) ? (
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
          {/* Only a folder WITH items can lack due dates. */}
          {!anyDue && k.total > 0 ? (
            <li className="inline-flex items-center rounded-sm border px-2 py-0.5 font-mono">
              No due dates set
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
