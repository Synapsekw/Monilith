import type {
  BucketCell,
  CapacityState,
  DayActual,
  MemberCapacity,
  MemberRow,
  OrgWorkloadDefaults,
  WeekBucket,
  WorkloadActualRow,
  WorkloadGrid,
  WorkloadMember,
  WorkloadRawRow,
} from "./types";

const DAY = 86_400_000;

/** Server "today" as an ISO date (UTC); passed explicitly so math stays testable. */
export function serverToday(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

function isoToUTC(iso: string): number {
  return Date.parse(iso + "T00:00:00Z");
}
function utcToIso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
/** ISO weekday 1=Mon … 7=Sun for an ISO date. */
function isoWeekday(iso: string): number {
  const d = new Date(isoToUTC(iso)).getUTCDay(); // 0=Sun … 6=Sat
  return d === 0 ? 7 : d;
}
/** Start (ISO date) of the bucket containing `iso`, given a weekStartsOn (1=Mon). */
function weekStartOf(iso: string, weekStartsOn: number): string {
  const wd = isoWeekday(iso);
  const back = (wd - weekStartsOn + 7) % 7;
  return utcToIso(isoToUTC(iso) - back * DAY);
}

/** Spread `effortSecs` evenly across the working days in [start, end] (inclusive). */
export function spreadItemEffort(
  start: string,
  end: string,
  effortSecs: number,
  workingDays: number[],
): Map<string, number> {
  const mask = new Set(workingDays);
  const days: string[] = [];
  for (let ms = isoToUTC(start); ms <= isoToUTC(end); ms += DAY) {
    const iso = utcToIso(ms);
    if (mask.has(isoWeekday(iso))) days.push(iso);
  }
  const out = new Map<string, number>();
  if (days.length === 0) {
    out.set(start, effortSecs); // never drop effort
    return out;
  }
  const per = effortSecs / days.length;
  for (const d of days) out.set(d, (out.get(d) ?? 0) + per);
  return out;
}

/** Roll a per-day effort map up into week buckets keyed by the bucket start. */
export function bucketByWeek(
  perDay: Map<string, number>,
  weekStartsOn: number,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const [iso, secs] of perDay) {
    const key = weekStartOf(iso, weekStartsOn);
    out.set(key, (out.get(key) ?? 0) + secs);
  }
  return out;
}

/** Count of working days in the 7-day bucket starting at `weekKey`. */
function workingDaysInBucket(weekKey: string, workingDays: number[]): number {
  const mask = new Set(workingDays);
  let n = 0;
  for (let i = 0; i < 7; i++) {
    if (mask.has(isoWeekday(utcToIso(isoToUTC(weekKey) + i * DAY)))) n++;
  }
  return n;
}

/** Ordered visible week buckets around `today`. */
export function buildWindow(
  today: string,
  weeksBack: number,
  weeksFwd: number,
  weekStartsOn: number,
): WeekBucket[] {
  const startKey = weekStartOf(today, weekStartsOn);
  const buckets: WeekBucket[] = [];
  for (let i = -weeksBack; i <= weeksFwd; i++) {
    const weekKey = utcToIso(isoToUTC(startKey) + i * 7 * DAY);
    const d = new Date(isoToUTC(weekKey));
    const label = d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
    buckets.push({ weekKey, label, workingDays: 5 });
  }
  return buckets;
}

export function capacityState(
  effortSecs: number,
  capacitySecs: number,
): CapacityState {
  if (capacitySecs <= 0) return "none";
  if (effortSecs > capacitySecs) return "over";
  if (effortSecs === capacitySecs) return "at";
  return "under";
}

/** ±band (fraction of plan) within which variance reads as neutral "on plan". */
const VARIANCE_BAND = 0.1;

/** Signed planned-vs-actual delta in seconds (+ = over plan). */
export function varianceSecs(actualSecs: number, plannedSecs: number): number {
  return actualSecs - plannedSecs;
}

/** Signed variance as a fraction of plan; null when there's no planned baseline. */
export function variancePct(
  actualSecs: number,
  plannedSecs: number,
): number | null {
  if (plannedSecs <= 0) return null;
  return (actualSecs - plannedSecs) / plannedSecs;
}

/** Tri-state for variance coloring: over / under / on (within band) / none. */
export function varianceState(
  actualSecs: number,
  plannedSecs: number,
): "over" | "under" | "on" | "none" {
  if (plannedSecs <= 0) return actualSecs > 0 ? "over" : "none";
  const pct = (actualSecs - plannedSecs) / plannedSecs;
  if (pct > VARIANCE_BAND) return "over";
  if (pct < -VARIANCE_BAND) return "under";
  return "on";
}

/** The day-by-day actuals behind one (member, week) cell, aggregated across
 * boards (after the active board filter), sorted by day. Pure filter over the
 * already-loaded actuals array → 0 round-trips (spec §5). */
export function actualsForCell(
  actuals: WorkloadActualRow[],
  userId: string,
  weekKey: string,
  weekStartsOn: number,
  boardIds: Set<string> | null,
): DayActual[] {
  const byDay = new Map<string, number>();
  for (const a of actuals) {
    if (a.userId !== userId) continue;
    if (boardIds !== null && !boardIds.has(a.boardId)) continue;
    if (weekStartOf(a.day, weekStartsOn) !== weekKey) continue;
    byDay.set(a.day, (byDay.get(a.day) ?? 0) + a.secs);
  }
  return [...byDay.entries()]
    .map(([day, secs]) => ({ day, secs }))
    .sort((x, y) => x.day.localeCompare(y.day));
}

function resolveCapacity(
  userId: string,
  caps: MemberCapacity[],
  defaults: OrgWorkloadDefaults,
): { hoursPerDay: number; workingDays: number[] } {
  const c = caps.find((x) => x.userId === userId);
  return c
    ? { hoursPerDay: c.hoursPerDay, workingDays: c.workingDays }
    : { hoursPerDay: defaults.hoursPerDay, workingDays: defaults.workingDays };
}

/** Subset rows (raw or actual) to a set of board ids; `null` ⇒ no filter (all).
 * Pure so workspace/board filtering recomputes the grid client-side with 0
 * round-trips (AGENTS.md §5). */
export function filterByBoards<T extends { boardId: string }>(
  rows: T[],
  boardIds: Set<string> | null,
): T[] {
  if (boardIds === null) return rows;
  return rows.filter((r) => boardIds.has(r.boardId));
}

/** Fold day-granular logged actuals into per-user week buckets. */
export function foldActualRows(
  actuals: WorkloadActualRow[],
  weekStartsOn: number,
): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const a of actuals) {
    let byWeek = out.get(a.userId);
    if (!byWeek) {
      byWeek = new Map<string, number>();
      out.set(a.userId, byWeek);
    }
    const key = weekStartOf(a.day, weekStartsOn);
    byWeek.set(key, (byWeek.get(key) ?? 0) + a.secs);
  }
  return out;
}

/** Top-level assembler: raw rows → per-member week-bucketed effort vs. capacity.
 * `actuals` (v2) fold logged time into each cell's `actualSecs`; omit for v1
 * planned-only behavior. */
export function buildWorkloadGrid(
  rows: WorkloadRawRow[],
  members: WorkloadMember[],
  caps: MemberCapacity[],
  defaults: OrgWorkloadDefaults,
  today: string,
  weeksBack: number,
  weeksFwd: number,
  weekStartsOn: number,
  actuals: WorkloadActualRow[] = [],
): WorkloadGrid {
  const window = buildWindow(today, weeksBack, weeksFwd, weekStartsOn);
  const windowKeys = new Set(window.map((b) => b.weekKey));

  // logged actuals per userId per weekKey (v2 overlay)
  const actualByUser = foldActualRows(actuals, weekStartsOn);

  // effort per (userId|null) per weekKey
  const effort = new Map<string | null, Map<string, number>>();
  const ensure = (uid: string | null) => {
    let m = effort.get(uid);
    if (!m) {
      m = new Map<string, number>();
      effort.set(uid, m);
    }
    return m;
  };

  for (const row of rows) {
    const cap =
      row.userId === null
        ? { hoursPerDay: 0, workingDays: defaults.workingDays } // spread over default calendar
        : resolveCapacity(row.userId, caps, defaults);
    const effortSecs =
      row.estimateSecs != null
        ? row.estimateSecs
        : defaults.perItemHours * 3600;
    const perDay = spreadItemEffort(
      row.startDate,
      row.endDate,
      effortSecs,
      cap.workingDays,
    );
    const byWeek = bucketByWeek(perDay, weekStartsOn);
    const target = ensure(row.userId);
    for (const [weekKey, secs] of byWeek) {
      if (!windowKeys.has(weekKey)) continue; // clamp to the visible window
      target.set(weekKey, (target.get(weekKey) ?? 0) + secs);
    }
  }

  const buildRow = (
    userId: string | null,
    member: WorkloadMember | null,
  ): MemberRow => {
    const eMap = effort.get(userId) ?? new Map<string, number>();
    const aMap =
      userId === null
        ? new Map<string, number>()
        : (actualByUser.get(userId) ?? new Map<string, number>());
    const cap =
      userId === null ? null : resolveCapacity(userId, caps, defaults);
    let totalEffort = 0;
    let totalCap = 0;
    let totalActual = 0;
    const cells: BucketCell[] = window.map((b) => {
      const effortSecs = eMap.get(b.weekKey) ?? 0;
      const actualSecs = aMap.get(b.weekKey) ?? 0;
      const capacitySecs =
        cap === null
          ? 0
          : workingDaysInBucket(b.weekKey, cap.workingDays) *
            cap.hoursPerDay *
            3600;
      totalEffort += effortSecs;
      totalCap += capacitySecs;
      totalActual += actualSecs;
      return {
        weekKey: b.weekKey,
        effortSecs,
        capacitySecs,
        actualSecs,
        ratio: capacitySecs > 0 ? effortSecs / capacitySecs : null,
        state: capacityState(effortSecs, capacitySecs),
      };
    });
    return {
      userId,
      member,
      cells,
      totalEffortSecs: totalEffort,
      totalCapacitySecs: totalCap,
      totalActualSecs: totalActual,
    };
  };

  const rowsOut: MemberRow[] = members.map((m) => buildRow(m.userId, m));
  if (effort.has(null)) rowsOut.unshift(buildRow(null, null)); // leading Unassigned row
  return { window, rows: rowsOut };
}
