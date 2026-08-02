import { requireUser } from "@/lib/auth/session";
import {
  getGoalLinks,
  getGoalOwners,
  getGoalsTree,
  listReadableBoardsCached,
} from "@/lib/goals/queries";
import { GoalsView } from "@/components/goals/GoalsView";
import { NewGoalDialog } from "@/components/goals/NewGoalDialog";
import { Kicker } from "@/components/ui/kicker";

export default async function GoalsIndex() {
  // Identity read OUTSIDE the cache scope (9.3 rule) — the user id keys the
  // cached readable-boards entry.
  const user = await requireUser();
  const [tree, ownerMap, boards, linkMap] = await Promise.all([
    getGoalsTree(),
    getGoalOwners(),
    listReadableBoardsCached(user.id),
    getGoalLinks(),
  ]);
  const members = [...ownerMap.values()];
  const boardOptions = boards.map((b) => ({ id: b.id, name: b.name }));
  const links = Object.fromEntries(linkMap);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-6 py-3">
        <div>
          <Kicker>PLANNING</Kicker>
          <h1 className="text-lg font-semibold">Goals</h1>
          <p className="text-muted-foreground text-xs">
            Measurable objectives that roll up across your org.
          </p>
        </div>
        <NewGoalDialog members={members} />
      </div>
      <GoalsView
        tree={tree}
        members={members}
        boards={boardOptions}
        links={links}
      />
    </div>
  );
}
