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

/** The value each KPI card shows right now (from the rollup); `null` means
 *  the card has no value, so it gets no trend either. */
export type KpiNow = Partial<Record<KpiKey, number | null>>;

/**
 * Weekly series behind each KPI card. Complete, gap and overdue look BACK over
 * up to eight weeks ending in the current one; due looks FORWARD from it. A
 * card with no entry draws no sparkline. `total` is the item count in scope.
 *
 * AGREEMENT RULE (2026-11-14 browser fix): a trend never contradicts the card
 * it sits on. When `now` is passed (KpisPanel always passes it), the series'
 * LATEST point is the card's own value from the rollup:
 *   - complete / gap / overdue: the current week's point is replaced by the
 *     card value ("as of today"); earlier points stay folder_burn's
 *     end-of-week values, which count on the same basis as the rollup (done =
 *     every done item with a done date; planned = items whose latest date is
 *     in or before that week). When the burn rows stop before the current
 *     week, the card value is appended as the newest point instead.
 *   - dueThisWeek: the first bar (this week) is the card value; later bars are
 *     folder_burn's planned counts for those weeks.
 *   - a card whose `now` value is null gets no trend.
 *   - overdue: folder_burn carries `overdue_open` only once the folder_tower
 *     migration is applied. Rows without it (`overdueOpen` undefined) would
 *     draw zeros ending in the card's value, so with `now` the overdue trend
 *     is omitted until the column exists.
 * Without `now` the raw folder_burn series is returned.
 */
export function kpiTrends(
  rows: BurnRow[],
  stage: string | null,
  todayISO: string,
  total: number,
  now?: KpiNow,
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
  // Anchor a past series on the card's value (see the rule above).
  const anchored = (key: KpiKey, points: number[]): Trend | undefined => {
    if (now === undefined || !(key in now)) return line(points);
    const v = now[key];
    if (v === null || v === undefined) return undefined;
    const pts = inWeek
      ? [...points.slice(0, -1), v]
      : [...points, v].slice(-TREND_WEEKS);
    return pts.length < 2 ? undefined : line(pts);
  };
  const out: Partial<Record<KpiKey, Trend>> = {};
  const gap = anchored(
    "gap",
    past.map((w) => w.completedCum - w.plannedCum),
  );
  if (gap) out.gap = gap;
  const hasOverdue = rows.some((r) => r.overdueOpen !== undefined);
  if (now === undefined || hasOverdue) {
    const overdue = anchored(
      "overdue",
      past.map((w) => w.overdueOpen),
    );
    if (overdue) out.overdue = overdue;
  }
  if (total > 0) {
    const complete = anchored(
      "complete",
      past.map((w) => Math.round((w.completedCum / total) * 100)),
    );
    if (complete) out.complete = complete;
  }
  if (ahead.length >= 2) {
    const first =
      now !== undefined && "dueThisWeek" in now
        ? now.dueThisWeek
        : ahead[0]!.planned;
    if (first !== null && first !== undefined) {
      const points = [first, ...ahead.slice(1).map((w) => w.planned)];
      out.dueThisWeek = {
        kind: "bars",
        points,
        delta: points[1]! - points[0]!,
      };
    }
  }
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
  /** Completions in the current week (not part of the pace window). */
  completedThisWeek?: number;
  /** Cumulative completions up to and including the current week. */
  completedCum?: number;
  /** False when the rows came from a folder_burn without `imported_done`
   *  (before the folder_tower migration): `importedDone` is then 0 because
   *  it is unknown, not because nothing was imported. */
  importedKnown?: boolean;
  /** Full weeks in the pace window (0 to 4): the weeks before the current one. */
  windowWeeks?: number;
  /** Completions in weeks before the pace window. */
  completedBeforeWindow?: number;
};

export function burnForecast(
  points: BurnPoint[],
  total: number,
  opts: { importedKnown?: boolean } = {},
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
    completedThisWeek: here.completed,
    completedCum: here.completedCum,
    importedKnown: opts.importedKnown ?? true,
    windowWeeks: window.length,
    completedBeforeWindow: Math.max(
      0,
      here.completedCum -
        here.completed -
        window.reduce((s, p) => s + p.completed, 0),
    ),
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
  if (f.pace === 0 || f.finishWeek === null) {
    // No pace. Say WHY, truthfully for what this data can know:
    //  - imported_done known and every completion so far arrived done: there
    //    never was any organic completion to pace on;
    //  - otherwise name the REAL window ("the N full weeks before this one",
    //    N = windowWeeks, 2 to 4, always written as a numeral), then
    //    "no recent pace" when completions exist before the window and
    //    "no pace yet" when none do, then this week's count if any. With the
    //    pre-migration folder_burn we cannot tell whether those were imported,
    //    so we claim neither.
    const cum = f.completedCum ?? 0;
    const thisWeek = f.completedThisWeek ?? 0;
    if (f.importedKnown !== false && cum > 0 && f.importedDone >= cum)
      return "Everything completed so far arrived already done, so there is no pace to forecast from.";
    const n = f.windowWeeks ?? 4;
    const why =
      (f.completedBeforeWindow ?? 0) > 0
        ? "so there is no recent pace"
        : "so there is no pace yet";
    const now =
      thisWeek > 0
        ? `; ${thisWeek} ${thisWeek === 1 ? "was" : "were"} completed this week`
        : "";
    return `No items were completed in the ${n} full ${n === 1 ? "week" : "weeks"} before this one, ${why}${now}.${imported}`;
  }
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
