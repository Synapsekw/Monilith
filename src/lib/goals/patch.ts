import { computeGoalHealth, leafProgress, serverToday } from "./progress";
import type { GoalNode, RowOwner } from "./types";
import type { Tables } from "@/types/database.types";

const clamp01 = (n: number) => Math.min(Math.max(n, 0), 1);

/**
 * Patch one goal row (as returned by updateGoal) into an already-built client
 * tree, recomputing what is derivable client-side: the patched node's own
 * progress for manual modes; auto_subgoals rollups up the tree; autoHealth for
 * touched nodes. auto_boards progress is left untouched (server goals_rollup;
 * link edits reconcile via revalidatePath). This is what lets a field blur cost
 * 0 server round-trips.
 */
export function applyGoalPatch(
  tree: GoalNode[],
  row: Tables<"goals">,
  owners?: Map<string, RowOwner>,
  today: string = serverToday(Date.now()),
): GoalNode[] {
  const walk = (nodes: GoalNode[]): GoalNode[] =>
    nodes.map((node) => {
      const children = walk(node.children);
      let next: GoalNode = { ...node, children };
      if (node.id === row.id) {
        next = {
          ...next,
          name: row.name,
          description: row.description,
          ownerId: row.owner_id,
          progressMode: row.progress_mode,
          status: row.status,
          startValue: row.start_value,
          currentValue: row.current_value,
          targetValue: row.target_value,
          unit: row.unit,
          percent: row.percent,
          startDate: row.start_date,
          dueDate: row.due_date,
          owner: owners?.get(row.owner_id) ?? node.owner,
        };
      }
      let progress = next.progress;
      if (next.progressMode === "auto_subgoals") {
        const vals = children
          .map((c) => c.progress)
          .filter((p): p is number => p != null);
        progress =
          vals.length === 0
            ? null
            : clamp01(vals.reduce((s, v) => s + v, 0) / vals.length);
      } else if (
        next.id === row.id &&
        (next.progressMode === "manual_percent" ||
          next.progressMode === "manual_number")
      ) {
        progress = leafProgress(next, []);
      }
      return {
        ...next,
        progress,
        autoHealth: computeGoalHealth({
          progress,
          startDate: next.startDate,
          dueDate: next.dueDate,
          today,
        }),
      };
    });
  return walk(tree);
}
