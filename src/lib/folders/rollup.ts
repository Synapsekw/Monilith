import type { StageSummary } from "./stages";
import { ALL_ITEMS_KEY, stageKey } from "./stages";
import type { BurnRow, FolderBoardRef, RollupRow } from "./types";

export type Kpis = {
  total: number;
  done: number;
  donePct: number | null;
  plannedByToday: number;
  gap: number | null;
  overdue: number;
  oldestOverdueDays: number | null;
  dueThisWeek: number;
  dueThisWeekNotStarted: number;
  blocked: number;
  stale: number;
};
export type BoardHealth = "on_track" | "at_risk" | "off_track";
export type BoardSummary = {
  id: string;
  name: string;
  health: BoardHealth;
  total: number;
  done: number;
  inProgress: number;
  overdue: number;
  notStarted: number;
  stale: number;
  donePct: number | null;
  nextMilestone: string | null;
};
export type MatrixBand = "green" | "blue" | "yellow" | "gray";
export type BurnPoint = {
  weekStart: string;
  planned: number;
  completed: number;
  plannedCum: number;
  completedCum: number;
  isPast: boolean;
};
export type Milestone = {
  stageKey: string;
  name: string;
  endDate: string;
  openBefore: number;
};

/** Whole days from `fromISO` to `toISO` (both `YYYY-MM-DD`); negative when reversed. */
export function daysBetween(fromISO: string, toISO: string): number {
  return Math.round((Date.parse(toISO) - Date.parse(fromISO)) / 864e5);
}

function rowStageKey(r: RollupRow): string {
  return r.groupName === null ? ALL_ITEMS_KEY : stageKey(r.groupName);
}

export function filterRows(
  rows: RollupRow[],
  f: { stageKey: string | null; boardId: string | null },
): RollupRow[] {
  return rows.filter(
    (r) =>
      (f.boardId === null || r.boardId === f.boardId) &&
      (f.stageKey === null || rowStageKey(r) === f.stageKey),
  );
}

export function computeKpis(rows: RollupRow[], todayISO: string): Kpis {
  let total = 0,
    done = 0,
    plannedByToday = 0,
    overdue = 0,
    dueThisWeek = 0;
  let dueThisWeekNotStarted = 0,
    blocked = 0,
    stale = 0;
  let oldest: string | null = null;
  let anyDue = false;
  for (const r of rows) {
    total += r.total;
    done += r.done;
    plannedByToday += r.plannedByToday;
    overdue += r.overdue;
    dueThisWeek += r.dueThisWeek;
    dueThisWeekNotStarted += r.dueThisWeekNotStarted;
    blocked += r.blocked;
    stale += r.stale;
    if (r.minDue !== null || r.maxDue !== null) anyDue = true;
    if (
      r.oldestOverdue !== null &&
      (oldest === null || r.oldestOverdue < oldest)
    )
      oldest = r.oldestOverdue;
  }
  return {
    total,
    done,
    donePct: total > 0 ? Math.round((done / total) * 100) : null,
    plannedByToday,
    gap: anyDue ? done - plannedByToday : null,
    overdue,
    oldestOverdueDays: oldest === null ? null : daysBetween(oldest, todayISO),
    dueThisWeek,
    dueThisWeekNotStarted,
    blocked,
    stale,
  };
}

/** Resolved ambiguity #7: the health pill rule over the digest's counts. */
export function boardHealth(b: {
  total: number;
  overdue: number;
  blocked: number;
  incomplete: number;
}): BoardHealth {
  if (b.total === 0) return "on_track";
  if (b.overdue >= 1 && (b.overdue + b.blocked) / b.total >= 0.2)
    return "off_track";
  if (b.overdue >= 1 || b.blocked >= 1 || b.incomplete / b.total >= 0.5)
    return "at_risk";
  return "on_track";
}

export function boardSummaries(
  rows: RollupRow[],
  boards: FolderBoardRef[],
  stages: StageSummary[],
): BoardSummary[] {
  const byBoard = new Map<string, RollupRow[]>();
  for (const r of rows)
    byBoard.set(r.boardId, [...(byBoard.get(r.boardId) ?? []), r]);
  return [...boards]
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
    .map((b) => {
      const rs = byBoard.get(b.id) ?? [];
      const sum = (
        k: keyof Pick<
          RollupRow,
          | "total"
          | "done"
          | "inProgress"
          | "overdue"
          | "notStarted"
          | "stale"
          | "blocked"
          | "incomplete"
        >,
      ) => rs.reduce((s, r) => s + r[k], 0);
      const total = sum("total");
      const keys = new Set(rs.map(rowStageKey));
      const next =
        stages
          .filter(
            (s) =>
              keys.has(s.key) && s.maxDue !== null && s.state !== "complete",
          )
          .map((s) => s.maxDue as string)
          .sort()[0] ?? null;
      return {
        id: b.id,
        name: b.name,
        health: boardHealth({
          total,
          overdue: sum("overdue"),
          blocked: sum("blocked"),
          incomplete: sum("incomplete"),
        }),
        total,
        done: sum("done"),
        inProgress: sum("inProgress"),
        overdue: sum("overdue"),
        notStarted: sum("notStarted"),
        stale: sum("stale"),
        donePct: total > 0 ? Math.round((sum("done") / total) * 100) : null,
        nextMilestone: next,
      };
    });
}

/** boardId → stageKey → percent done (null: the board has no such group). */
export function stageMatrix(
  rows: RollupRow[],
): Map<string, Map<string, number | null>> {
  const m = new Map<string, Map<string, number | null>>();
  const keys = new Set(rows.filter((r) => r.groupId !== null).map(rowStageKey));
  for (const r of rows) {
    if (!m.has(r.boardId))
      m.set(r.boardId, new Map([...keys].map((k) => [k, null])));
    if (r.groupId === null) continue;
    const cell = m.get(r.boardId) as Map<string, number | null>;
    const prev = cell.get(rowStageKey(r));
    const pct = r.total > 0 ? Math.round((r.done / r.total) * 100) : 0;
    cell.set(
      rowStageKey(r),
      prev === null || prev === undefined ? pct : Math.round((prev + pct) / 2),
    );
  }
  return m;
}

export function band(pct: number): MatrixBand {
  if (pct >= 90) return "green";
  if (pct >= 50) return "blue";
  if (pct >= 25) return "yellow";
  return "gray";
}

/** Next `n` stage end dates (latest due inside the stage) on/after today, with the open count before each. */
export function nextMilestones(
  stages: StageSummary[],
  todayISO: string,
  n = 3,
): Milestone[] {
  const ordered = [...stages].sort((a, b) => a.position - b.position);
  const out: Milestone[] = [];
  const upcoming = ordered
    .filter((s) => s.maxDue !== null && s.maxDue >= todayISO)
    .sort((a, b) => (a.maxDue as string).localeCompare(b.maxDue as string));
  for (const s of upcoming.slice(0, n)) {
    const idx = ordered.findIndex((x) => x.key === s.key);
    const openBefore = ordered
      .slice(0, idx + 1)
      .reduce((acc, x) => acc + (x.total - x.done), 0);
    out.push({
      stageKey: s.key,
      name: s.name,
      endDate: s.maxDue as string,
      openBefore,
    });
  }
  return out;
}

/** Open items in a stage that is COMPLETE on at least one other board (spec §5.3.4). */
export function carryOver(rows: RollupRow[], stages: StageSummary[]): number {
  const byStage = new Map<string, RollupRow[]>();
  for (const r of rows) {
    if (r.groupId === null) continue;
    byStage.set(rowStageKey(r), [...(byStage.get(rowStageKey(r)) ?? []), r]);
  }
  let n = 0;
  for (const s of stages) {
    const rs = byStage.get(s.key) ?? [];
    const completeSomewhere = rs.some((r) => r.total > 0 && r.done === r.total);
    if (!completeSomewhere) continue;
    for (const r of rs)
      if (r.total > 0 && r.done < r.total) n += r.total - r.done;
  }
  return n;
}

export function onlyOnOneBoard(
  rows: RollupRow[],
  stages: StageSummary[],
): {
  groupId: string;
  groupName: string;
  boardId: string;
  boardName: string;
}[] {
  const single = new Set(
    stages
      .filter((s) => s.onlyOnBoard !== null && s.key !== ALL_ITEMS_KEY)
      .map((s) => s.key),
  );
  return rows
    .filter(
      (r) =>
        r.groupId !== null &&
        r.groupName !== null &&
        single.has(rowStageKey(r)),
    )
    .map((r) => ({
      groupId: r.groupId as string,
      groupName: (r.groupName as string).trim(),
      boardId: r.boardId,
      boardName: r.boardName,
    }));
}

/** Weekly + cumulative series for one stage (or all stages summed). Rows are already contiguous per stage (folder_burn). */
export function burnSeries(
  rows: BurnRow[],
  stage: string | null,
  todayISO: string,
): BurnPoint[] {
  const weeks = new Map<string, { planned: number; completed: number }>();
  for (const r of rows) {
    if (stage !== null && r.stageKey !== stage) continue;
    const w = weeks.get(r.weekStart) ?? { planned: 0, completed: 0 };
    w.planned += r.planned;
    w.completed += r.completed;
    weeks.set(r.weekStart, w);
  }
  const thisWeek =
    [...weeks.keys()]
      .filter((w) => w <= todayISO)
      .sort()
      .at(-1) ?? null;
  let pc = 0,
    cc = 0;
  return [...weeks.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekStart, w]) => {
      pc += w.planned;
      cc += w.completed;
      return {
        weekStart,
        planned: w.planned,
        completed: w.completed,
        plannedCum: pc,
        completedCum: cc,
        isPast: thisWeek !== null && weekStart <= thisWeek,
      };
    });
}
