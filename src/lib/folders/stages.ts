import type { RollupRow } from "./types";

/** The synthetic stage used when no board in the folder has a group (spec §8). */
export const ALL_ITEMS_KEY = "__all__";

export type StageState = "complete" | "in_flight" | "upcoming";

export type StageSummary = {
  key: string;
  name: string;
  color: string;
  position: number;
  boardIds: string[];
  /** Set when exactly one board carries this stage ("Only on <board>"). */
  onlyOnBoard: string | null;
  total: number;
  done: number;
  inProgress: number;
  overdue: number;
  notStarted: number;
  blocked: number;
  stale: number;
  unassigned: number;
  minDue: string | null;
  maxDue: string | null;
  state: StageState;
};

/** Spec §3.4: a stage is a distinct trim(lower(group name)) across the folder. */
export function stageKey(name: string): string {
  return name.trim().toLowerCase();
}

function minISO(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return a < b ? a : b;
}
function maxISO(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return a > b ? a : b;
}

function stateOf(s: Omit<StageSummary, "state">, todayISO: string): StageState {
  if (s.total > 0 && s.done === s.total) return "complete";
  if (s.inProgress > 0 || s.overdue > 0) return "in_flight";
  if (
    s.minDue !== null &&
    s.maxDue !== null &&
    s.minDue <= todayISO &&
    todayISO <= s.maxDue
  )
    return "in_flight";
  return "upcoming";
}

/**
 * Fold rollup rows into stages. Name/colour are first-seen (lowest board
 * position, then group position); order is the minimum group position across
 * boards. Rows with no group (a board without groups) only matter when NO row
 * has a group — then they form the single "All items" stage.
 */
export function buildStages(
  rows: RollupRow[],
  todayISO: string,
): StageSummary[] {
  const grouped = rows.filter(
    (r) => r.groupId !== null && r.groupName !== null,
  );
  const source = grouped.length > 0 ? grouped : rows;
  const acc = new Map<
    string,
    Omit<StageSummary, "state"> & { seenAt: [number, number] }
  >();

  const sorted = [...source].sort(
    (a, b) =>
      a.boardPosition - b.boardPosition ||
      (a.groupPosition ?? 0) - (b.groupPosition ?? 0),
  );
  for (const r of sorted) {
    const key =
      grouped.length > 0 ? stageKey(r.groupName as string) : ALL_ITEMS_KEY;
    const name =
      grouped.length > 0 ? (r.groupName as string).trim() : "All items";
    const position = r.groupPosition ?? 0;
    const cur = acc.get(key);
    if (!cur) {
      acc.set(key, {
        key,
        name,
        color: r.groupColor ?? "#0073ea",
        position,
        boardIds: [r.boardId],
        onlyOnBoard: r.boardId,
        total: r.total,
        done: r.done,
        inProgress: r.inProgress,
        overdue: r.overdue,
        notStarted: r.notStarted,
        blocked: r.blocked,
        stale: r.stale,
        unassigned: r.unassigned,
        minDue: r.minDue,
        maxDue: r.maxDue,
        seenAt: [r.boardPosition, position],
      });
      continue;
    }
    if (!cur.boardIds.includes(r.boardId)) cur.boardIds.push(r.boardId);
    cur.onlyOnBoard = cur.boardIds.length === 1 ? cur.boardIds[0] : null;
    cur.position = Math.min(cur.position, position);
    cur.total += r.total;
    cur.done += r.done;
    cur.inProgress += r.inProgress;
    cur.overdue += r.overdue;
    cur.notStarted += r.notStarted;
    cur.blocked += r.blocked;
    cur.stale += r.stale;
    cur.unassigned += r.unassigned;
    cur.minDue = minISO(cur.minDue, r.minDue);
    cur.maxDue = maxISO(cur.maxDue, r.maxDue);
  }

  return [...acc.values()]
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
    .map(({ seenAt: _seen, ...s }) => ({ ...s, state: stateOf(s, todayISO) }));
}
