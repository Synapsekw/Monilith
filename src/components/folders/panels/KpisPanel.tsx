import { Fragment, type ReactNode } from "react";
import { KpiCard } from "@/components/folders/charts/KpiCard";
import { computeKpis, type Kpis } from "@/lib/folders/rollup";
import type { KpiKey } from "@/lib/validations/folder-layout";
import type { RollupRow } from "@/lib/folders/types";
import { Failed } from "./Panel";

const CARD: Record<KpiKey, (k: Kpis) => ReactNode> = {
  complete: (k) => (
    <KpiCard
      label="Complete"
      value={k.donePct === null ? "—" : `${k.donePct}%`}
      badge={{ text: `${k.done} done`, color: "green" }}
      subFact={`${k.plannedByToday} planned by today`}
      progress={k.donePct}
      barColor="green"
    />
  ),
  gap: (k) => (
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
  ),
  overdue: (k) => (
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
  ),
  dueThisWeek: (k) => (
    <KpiCard
      label="Due this week"
      value={String(k.dueThisWeek)}
      subFact={`${k.dueThisWeekNotStarted} not yet started`}
      progress={
        k.dueThisWeek === 0
          ? null
          : ((k.dueThisWeek - k.dueThisWeekNotStarted) / k.dueThisWeek) * 100
      }
      barColor="blue"
    />
  ),
  blocked: (k) => (
    <KpiCard
      label="Blocked"
      value={String(k.blocked)}
      subFact="status blocked or stuck"
      progress={k.total === 0 ? null : (k.blocked / k.total) * 100}
      barColor="red"
    />
  ),
  stale: (k) => (
    <KpiCard
      label="Stale"
      value={String(k.stale)}
      subFact="untouched > 14 days"
      progress={k.total === 0 ? null : (k.stale / k.total) * 100}
      barColor="yellow"
    />
  ),
};

/** The KPI row. `cards` is the folder's chosen subset, in its chosen order —
 *  the grid stays 6-up at xl so a 3-card CRM row doesn't stretch. */
export function KpisPanel({
  cards,
  rows,
  todayISO,
  failed,
  onRetry,
}: {
  cards: KpiKey[];
  rows: RollupRow[];
  todayISO: string;
  failed: boolean;
  onRetry: () => void;
}) {
  const k = computeKpis(rows, todayISO);
  if (failed) return <Failed onRetry={onRetry} />;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      {cards.map((key) => (
        <Fragment key={key}>{CARD[key](k)}</Fragment>
      ))}
    </div>
  );
}
