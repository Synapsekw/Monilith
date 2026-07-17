"use client";

import { useCallback, useMemo, useState } from "react";
import { GoalTree } from "./GoalTree";
import { GoalDetailDrawer } from "./GoalDetailDrawer";
import { applyGoalPatch } from "@/lib/goals/patch";
import type { GoalNode, RowOwner } from "@/lib/goals/types";
import type { GoalLink } from "@/lib/goals/queries";
import type { Tables } from "@/types/database.types";

/**
 * Client owner of the goals tree. Field edits in the drawer call onGoalPatched
 * with the row returned by updateGoal and we reconcile locally (0 refetches).
 * Structural mutations revalidate "/goals" in their actions; when that payload
 * lands, the `tree` prop identity changes and we resync to server truth during
 * render (the repo's no-effect prop->state reset, matching TimeCell).
 */
export function GoalsView({
  tree,
  members,
  boards,
  links,
}: {
  tree: GoalNode[];
  members: RowOwner[];
  boards: { id: string; name: string }[];
  links: Record<string, GoalLink[]>;
}) {
  const [localTree, setLocalTree] = useState(tree);
  // Resync to server truth when a structural revalidate lands a new tree, done
  // during render (no effect) so a cascading re-render never fires.
  const [prevTree, setPrevTree] = useState(tree);
  if (tree !== prevTree) {
    setPrevTree(tree);
    setLocalTree(tree);
  }
  const owners = useMemo(
    () => new Map(members.map((m) => [m.userId, m])),
    [members],
  );
  const onGoalPatched = useCallback(
    (row: Tables<"goals">) =>
      setLocalTree((prev) => applyGoalPatch(prev, row, owners)),
    [owners],
  );
  return (
    <>
      <div className="min-h-0 flex-1">
        <GoalTree tree={localTree} />
      </div>
      <GoalDetailDrawer
        tree={localTree}
        members={members}
        boards={boards}
        links={links}
        onGoalPatched={onGoalPatched}
      />
    </>
  );
}
