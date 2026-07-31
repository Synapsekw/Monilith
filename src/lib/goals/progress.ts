import type {
  BoardAgg,
  GoalHealth,
  GoalNode,
  GoalRow,
  RowOwner,
} from "./types";

const DAY = 86_400_000;
const clamp01 = (n: number) => Math.min(Math.max(n, 0), 1);
function daysBetween(a: string, b: string): number {
  return (Date.parse(b) - Date.parse(a)) / DAY;
}

/** Server "today" as an ISO date (UTC); passed explicitly so health stays testable. */
export function serverToday(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** Progress (0..1) for a single goal, ignoring children. auto_subgoals → null here. */
export function leafProgress(
  goal: GoalRow,
  boardAggs: BoardAgg[],
): number | null {
  switch (goal.progressMode) {
    case "manual_number": {
      const start = goal.startValue ?? 0;
      const current = goal.currentValue ?? start;
      const target = goal.targetValue;
      if (target == null || target === start) return null;
      return clamp01((current - start) / (target - start));
    }
    case "manual_percent":
      return goal.percent == null ? null : clamp01(goal.percent / 100);
    case "auto_boards": {
      let total = 0;
      let done = 0;
      for (const a of boardAggs) {
        if (a.goalId !== goal.id) continue;
        total += a.total;
        done += a.done;
      }
      return total === 0 ? null : clamp01(done / total);
    }
    case "auto_subgoals":
      return null;
  }
}

export function computeGoalHealth(input: {
  progress: number | null;
  startDate: string | null;
  dueDate: string | null;
  today: string;
}): GoalHealth | null {
  const { progress, startDate, dueDate, today } = input;
  if (progress === null && dueDate === null) return null;
  if (
    dueDate !== null &&
    today > dueDate &&
    (progress === null || progress < 1)
  ) {
    return "off_track";
  }
  let behind = false;
  if (progress !== null && startDate !== null && dueDate !== null) {
    const span = daysBetween(startDate, dueDate);
    if (span > 0) {
      const elapsed = clamp01(daysBetween(startDate, today) / span);
      behind = progress < elapsed;
    }
  }
  return behind ? "at_risk" : "on_track";
}

/** Assemble flat rows into a forest, computing progress + auto-health post-order. */
export function buildGoalTree(
  rows: GoalRow[],
  boardAggs: BoardAgg[],
  owners: Map<string, RowOwner>,
  today: string,
): GoalNode[] {
  const byParent = new Map<string | null, GoalRow[]>();
  for (const r of rows) {
    const list = byParent.get(r.parentGoalId) ?? [];
    list.push(r);
    byParent.set(r.parentGoalId, list);
  }

  const visiting = new Set<string>();
  function build(rowNode: GoalRow): GoalNode {
    visiting.add(rowNode.id);
    const children = (byParent.get(rowNode.id) ?? [])
      .slice()
      .sort((a, b) => a.position - b.position)
      .filter((c) => !visiting.has(c.id)) // defensive cycle guard
      .map(build);
    visiting.delete(rowNode.id);

    let progress: number | null;
    if (rowNode.progressMode === "auto_subgoals") {
      const vals = children
        .map((c) => c.progress)
        .filter((p): p is number => p != null);
      progress =
        vals.length === 0
          ? null
          : clamp01(vals.reduce((s, v) => s + v, 0) / vals.length);
    } else {
      progress = leafProgress(rowNode, boardAggs);
    }

    return {
      ...rowNode,
      children,
      progress,
      autoHealth: computeGoalHealth({
        progress,
        startDate: rowNode.startDate,
        dueDate: rowNode.dueDate,
        today,
      }),
      owner: owners.get(rowNode.ownerId) ?? null,
    };
  }

  return (byParent.get(null) ?? [])
    .slice()
    .sort((a, b) => a.position - b.position)
    .map(build);
}
