import type {
  Placement,
  PortfolioHealth,
  PortfolioRow,
  RollupRow,
  RowOwner,
} from "./types";

const DAY = 86_400_000;
function daysBetween(a: string, b: string): number {
  return (Date.parse(b) - Date.parse(a)) / DAY;
}

/** Server "today" as an ISO date (UTC). NOTE (spec §10): align with per-user
 *  timezone work when it lands; passed explicitly so it stays testable. */
export function serverToday(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function progressPct(row: {
  totalItems: number;
  doneItems: number;
  doneColumnId: string | null;
}): number | null {
  if (row.doneColumnId == null) return null;
  if (row.totalItems === 0) return null;
  return Math.round((row.doneItems / row.totalItems) * 100);
}

export function computeAutoHealth(input: {
  progressPct: number | null;
  timelineStart: string | null;
  timelineEnd: string | null;
  overdueItems: number;
  today: string;
}): PortfolioHealth | null {
  const {
    progressPct: pct,
    timelineStart,
    timelineEnd,
    overdueItems,
    today,
  } = input;

  // Nothing to judge: no progress signal, no timeline, no overdue work.
  if (pct === null && timelineEnd === null && overdueItems === 0) return null;

  // Past the deadline and not finished.
  if (
    timelineEnd !== null &&
    today > timelineEnd &&
    (pct === null || pct < 100)
  ) {
    return "off_track";
  }

  // Behind pace: progress trails the fraction of the window elapsed.
  let behind = false;
  if (pct !== null && timelineStart !== null && timelineEnd !== null) {
    const span = daysBetween(timelineStart, timelineEnd);
    if (span > 0) {
      const elapsed =
        Math.min(Math.max(daysBetween(timelineStart, today) / span, 0), 1) *
        100;
      behind = pct < elapsed;
    }
  }
  if (behind || overdueItems > 0) return "at_risk";
  return "on_track";
}

export function mergeRows(
  placements: Placement[],
  rollups: RollupRow[],
  owners: Map<string, RowOwner>,
  today: string,
): PortfolioRow[] {
  const byBoard = new Map(rollups.map((r) => [r.boardId, r]));
  return placements
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((p) => {
      const r = byBoard.get(p.boardId);
      const totalItems = r?.totalItems ?? 0;
      const doneItems = r?.doneItems ?? 0;
      const timelineStart = r?.timelineStart ?? null;
      const timelineEnd = r?.timelineEnd ?? null;
      const overdueItems = r?.overdueItems ?? 0;
      const pct = progressPct({
        totalItems,
        doneItems,
        doneColumnId: p.doneColumnId,
      });
      const autoHealth = computeAutoHealth({
        progressPct: pct,
        timelineStart,
        timelineEnd,
        overdueItems,
        today,
      });
      return {
        ...p,
        name: r?.name ?? "(no access)",
        totalItems,
        doneItems,
        progressPct: pct,
        timelineStart,
        timelineEnd,
        overdueItems,
        autoHealth,
        health: p.healthOverride ?? autoHealth,
        owner: p.ownerUserId ? (owners.get(p.ownerUserId) ?? null) : null,
      };
    });
}
