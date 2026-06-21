import { requireUser } from "@/lib/auth/session";
import {
  getGoalLinks,
  getGoalOwners,
  getGoalsTree,
  listReadableBoards,
} from "@/lib/goals/queries";
import { GoalTree } from "@/components/goals/GoalTree";
import { GoalDetailDrawer } from "@/components/goals/GoalDetailDrawer";
import { NewGoalDialog } from "@/components/goals/NewGoalDialog";

export default async function GoalsIndex() {
  await requireUser();
  const [tree, ownerMap, boards, linkMap] = await Promise.all([
    getGoalsTree(),
    getGoalOwners(),
    listReadableBoards(),
    getGoalLinks(),
  ]);
  const members = [...ownerMap.values()];
  const boardOptions = boards.map((b) => ({ id: b.id, name: b.name }));
  const links = Object.fromEntries(linkMap);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-6 py-3">
        <div>
          <h1 className="text-lg font-semibold">Goals</h1>
          <p className="text-muted-foreground text-xs">
            Measurable objectives that roll up across your org.
          </p>
        </div>
        <NewGoalDialog members={members} />
      </div>
      <div className="min-h-0 flex-1">
        <GoalTree tree={tree} />
      </div>
      <GoalDetailDrawer tree={tree} members={members} boards={boardOptions} links={links} />
    </div>
  );
}
