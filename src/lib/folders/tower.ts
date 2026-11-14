import type { KpiKey } from "@/lib/validations/folder-layout";
import { daysBetween, type BurnPoint } from "./rollup";
import type { StageSummary } from "./stages";
import type {
  AttentionRow,
  BurnRow,
  FolderBoardRef,
  LoadRow,
  RollupRow,
} from "./types";

/** A subset of the status palette; assignable to `StatusColor`. */
export type Tone = "green" | "red" | "blue" | "gray";

export type Trend = {
  kind: "line" | "bars";
  points: number[];
  /** Last point minus the one before it (bars: next week minus this week). */
  delta: number;
};

export const TREND_WEEKS = 8;
export const LOAD_BACK = 3;
export const LOAD_AHEAD = 3;

export function addDays(iso: string, n: number): string {
  return new Date(Date.parse(iso) + n * 864e5).toISOString().slice(0, 10);
}

/** The Monday on or before `iso`, matching Postgres `date_trunc('week', …)`. */
export function mondayOf(iso: string): string {
  const dow = (new Date(Date.parse(iso)).getUTCDay() + 6) % 7;
  return addDays(iso, -dow);
}

type Wk = {
  weekStart: string;
  planned: number;
  completed: number;
  overdueOpen: number;
  plannedCum: number;
  completedCum: number;
};

function weekly(rows: BurnRow[], stage: string | null): Wk[] {
  const m = new Map<
    string,
    { planned: number; completed: number; overdueOpen: number }
  >();
  for (const r of rows) {
    if (stage !== null && r.stageKey !== stage) continue;
    const w = m.get(r.weekStart) ?? {
      planned: 0,
      completed: 0,
      overdueOpen: 0,
    };
    w.planned += r.planned;
    w.completed += r.completed;
    w.overdueOpen += r.overdueOpen ?? 0;
    m.set(r.weekStart, w);
  }
  let pc = 0;
  let cc = 0;
  return [...m.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekStart, w]) => {
      pc += w.planned;
      cc += w.completed;
      return { weekStart, ...w, plannedCum: pc, completedCum: cc };
    });
}

/**
 * Weekly series behind each KPI card. Complete, gap and overdue look BACK over
 * up to eight weeks ending in the current one; due looks FORWARD from it. A
 * card with no entry draws no sparkline. `total` is the item count in scope.
 */
export function kpiTrends(
  rows: BurnRow[],
  stage: string | null,
  todayISO: string,
  total: number,
): Partial<Record<KpiKey, Trend>> {
  const ws = weekly(rows, stage);
  let cur = -1;
  for (let i = 0; i < ws.length; i++) if (ws[i]!.weekStart <= todayISO) cur = i;
  if (cur < 1) return {};
  // Only a row whose week contains today is the current week; when the burn
  // rows stop earlier the trend ends at the last real week.
  const inWeek = daysBetween(ws[cur]!.weekStart, todayISO) < 7;
  const past = ws.slice(Math.max(0, cur - (TREND_WEEKS - 1)), cur + 1);
  const ahead = inWeek ? ws.slice(cur, cur + TREND_WEEKS) : [];
  const line = (points: number[]): Trend => ({
    kind: "line",
    points,
    delta: points[points.length - 1]! - points[points.length - 2]!,
  });
  const out: Partial<Record<KpiKey, Trend>> = {
    gap: line(past.map((w) => w.completedCum - w.plannedCum)),
    overdue: line(past.map((w) => w.overdueOpen)),
  };
  if (total > 0)
    out.complete = line(
      past.map((w) => Math.round((w.completedCum / total) * 100)),
    );
  if (ahead.length >= 2)
    out.dueThisWeek = {
      kind: "bars",
      points: ahead.map((w) => w.planned),
      delta: ahead[1]!.planned - ahead[0]!.planned,
    };
  return out;
}

/** The change pill. Colour follows meaning (more overdue is red); the text
 *  always states the direction, so colour is never the only signal. */
export function trendChange(
  key: KpiKey,
  t: Trend,
): { text: string; tone: Tone } {
  if (key === "dueThisWeek")
    return { text: `${t.points[1] ?? 0} next week`, tone: "blue" };
  if (t.delta === 0) return { text: "flat", tone: "gray" };
  const up = t.delta > 0;
  const n = Math.abs(t.delta);
  if (key === "complete")
    return {
      text: `${up ? "+" : "−"}${n} pts this week`,
      tone: up ? "green" : "red",
    };
  if (key === "gap")
    return up
      ? { text: `${n} closer`, tone: "green" }
      : { text: `${n} wider`, tone: "red" };
  return {
    text: `${up ? "+" : "−"}${n} this week`,
    tone: up ? "red" : "green",
  };
}

export type Forecast = {
  /** Mean weekly completions over up to four full weeks before the current
   *  one (at least two), not counting items that arrived already done. */
  pace: number;
  importedDone: number;
  remaining: number;
  /** Completed minus planned, cumulative, at the current week. */
  gapNow: number;
  finishWeek: string | null;
  lastPlannedWeek: string | null;
  weeksLate: number | null;
  line: { weekStart: string; value: number }[];
  /** True when fewer than two full weeks precede the current one; no pace,
   *  date or line is produced then. */
  insufficientHistory: boolean;
};

export function burnForecast(
  points: BurnPoint[],
  total: number,
): Forecast | null {
  let cur = -1;
  for (let i = 0; i < points.length; i++) if (points[i]!.isPast) cur = i;
  if (cur === -1) return null;
  const here = points[cur]!;
  const window = points.slice(Math.max(0, cur - 4), cur);
  const organic = window.reduce(
    (s, p) => s + Math.max(0, p.completed - p.importedDone),
    0,
  );
  const pace = window.length === 0 ? 0 : organic / window.length;
  const remaining = Math.max(0, total - here.completedCum);
  let lastPlannedWeek: string | null = null;
  for (const p of points) if (p.planned > 0) lastPlannedWeek = p.weekStart;
  const insufficientHistory = window.length < 2;
  const finishWeek = insufficientHistory
    ? null
    : remaining === 0
      ? here.weekStart
      : pace > 0
        ? addDays(here.weekStart, Math.ceil(remaining / pace) * 7)
        : null;
  const weeksLate =
    finishWeek !== null && lastPlannedWeek !== null
      ? Math.max(0, Math.round(daysBetween(lastPlannedWeek, finishWeek) / 7))
      : null;
  return {
    pace,
    importedDone: points.reduce((s, p) => s + p.importedDone, 0),
    remaining,
    gapNow: here.completedCum - here.plannedCum,
    finishWeek,
    lastPlannedWeek,
    weeksLate,
    line: insufficientHistory
      ? []
      : points.slice(cur).map((p, i) => ({
          weekStart: p.weekStart,
          value: Math.min(total, Math.round(here.completedCum + pace * i)),
        })),
    insufficientHistory,
  };
}

function fmtDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function forecastReading(f: Forecast): string {
  if (f.remaining === 0) return "Everything in scope is done.";
  if (f.insufficientHistory) return "Not enough history yet to forecast.";
  const imported =
    f.importedDone > 0
      ? f.importedDone === 1
        ? " 1 item arrived already done and is left out of the pace."
        : ` ${f.importedDone} items arrived already done and are left out of the pace.`
      : "";
  if (f.pace === 0 || f.finishWeek === null)
    return `No items completed in the last four weeks.${imported}`;
  const pace =
    f.pace >= 10
      ? String(Math.round(f.pace))
      : f.pace.toFixed(1).replace(/\.0$/, "");
  const late =
    f.weeksLate !== null && f.weeksLate > 0
      ? `, ${f.weeksLate} ${f.weeksLate === 1 ? "week" : "weeks"} after its last planned date`
      : "";
  return `At ${pace} a week the folder finishes around ${fmtDay(f.finishWeek)}${late}.${imported}`;
}

export type LoadGrid = {
  weeks: { weekStart: string; label: string; past: boolean }[];
  rows: { boardId: string; name: string; cells: number[] }[];
  max: number;
};

export function loadGrid(
  rows: LoadRow[],
  boards: FolderBoardRef[],
  f: { stageKey: string | null; boardId: string | null },
  todayISO: string,
): LoadGrid {
  const now = mondayOf(todayISO);
  const weeks: LoadGrid["weeks"] = [];
  for (let o = -LOAD_BACK; o <= LOAD_AHEAD; o++)
    weeks.push({
      weekStart: addDays(now, o * 7),
      label:
        o === -LOAD_BACK
          ? `≤ −${LOAD_BACK}w`
          : o < 0
            ? `−${-o}w`
            : o === 0
              ? "now"
              : `+${o}w`,
      past: o < 0,
    });
  const idx = new Map(weeks.map((w, i) => [w.weekStart, i]));
  const byBoard = new Map<string, number[]>();
  for (const r of rows) {
    if (f.boardId !== null && r.boardId !== f.boardId) continue;
    if (f.stageKey !== null && r.stageKey !== f.stageKey) continue;
    // Older than the window folds into the first column; later is skipped.
    const i = r.weekStart < weeks[0]!.weekStart ? 0 : idx.get(r.weekStart);
    if (i === undefined) continue;
    const cells = byBoard.get(r.boardId) ?? weeks.map(() => 0);
    cells[i] = (cells[i] ?? 0) + r.openDue;
    byBoard.set(r.boardId, cells);
  }
  const out = boards
    .filter((b) => f.boardId === null || b.id === f.boardId)
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
    .map((b) => ({
      boardId: b.id,
      name: b.name,
      cells: byBoard.get(b.id) ?? weeks.map(() => 0),
    }));
  return { weeks, rows: out, max: Math.max(0, ...out.flatMap((r) => r.cells)) };
}

export type AttentionGroup = {
  boardId: string;
  boardName: string;
  overdue: number;
  blocked: number;
  unassigned: number;
  stale: number;
  oldestOverdueDays: number | null;
  /** The slice of the attention sample that belongs to this board. */
  items: AttentionRow[];
};

/**
 * Attention by board. The four counts come from the rollup, so they are
 * totals, not a sample; they count each property independently and can
 * overlap. `items` is whatever part of the top-N sample sits on that board.
 */
export function attentionGroups(
  rows: RollupRow[],
  attention: AttentionRow[],
  todayISO: string,
): AttentionGroup[] {
  const acc = new Map<string, AttentionGroup & { oldest: string | null }>();
  for (const r of rows) {
    const g = acc.get(r.boardId) ?? {
      boardId: r.boardId,
      boardName: r.boardName,
      overdue: 0,
      blocked: 0,
      unassigned: 0,
      stale: 0,
      oldestOverdueDays: null,
      items: [],
      oldest: null,
    };
    g.overdue += r.overdue;
    g.blocked += r.blocked;
    g.unassigned += r.unassigned;
    g.stale += r.stale;
    if (
      r.oldestOverdue !== null &&
      (g.oldest === null || r.oldestOverdue < g.oldest)
    )
      g.oldest = r.oldestOverdue;
    acc.set(r.boardId, g);
  }
  for (const a of attention) acc.get(a.boardId)?.items.push(a);
  return [...acc.values()]
    .filter(
      (g) =>
        g.overdue + g.blocked + g.unassigned + g.stale > 0 ||
        g.items.length > 0,
    )
    .map(({ oldest, ...g }) => ({
      ...g,
      oldestOverdueDays: oldest === null ? null : daysBetween(oldest, todayISO),
    }))
    .sort(
      (a, b) =>
        b.overdue - a.overdue ||
        b.blocked +
          b.unassigned +
          b.stale -
          (a.blocked + a.unassigned + a.stale) ||
        a.boardName.localeCompare(b.boardName),
    );
}

export type StageBar = {
  key: string;
  name: string;
  color: string;
  total: number;
  done: number;
  stale: number;
};

/** One bar per non-empty stage, in stage order: the no-dates burn fallback. */
export function stageBars(stages: StageSummary[]): StageBar[] {
  return stages
    .filter((s) => s.total > 0)
    .map((s) => ({
      key: s.key,
      name: s.name,
      color: s.color,
      total: s.total,
      done: s.done,
      stale: s.stale,
    }));
}
