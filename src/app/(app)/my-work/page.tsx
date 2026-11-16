import { requireUser } from "@/lib/auth/session";
import { getMyWorkPageData } from "@/lib/my-work/queries";
import { MyWorkList } from "@/components/my-work/MyWorkList";
import { TodayFocus } from "@/components/my-work/TodayFocus";
import { PageHeader } from "@/components/ui/page-header";

/**
 * "My Work" — the primary persona's #1 job: what to do first today, then
 * everything assigned to me across every board, grouped by when it's due. Both
 * come from ONE server read (RSC) on first paint. The grouped list is a pure
 * server render; the Today block above it is a client component: "Show more"
 * reveals rows already loaded (no refetch), and its row actions (mark done,
 * change due date) are Server Actions that revalidate this page, so the fresh
 * render of both the block and the list comes back with the action itself.
 * Each row deep-links to the item on its board via `?item=` (opens the
 * ItemPanel) — see MyWorkList and TodayFocus.
 */
export default async function MyWorkPage() {
  await requireUser();
  const { today, groups, focus, canAsk } = await getMyWorkPageData();
  const firstDated = groups
    .flatMap((g) => g.items)
    .find((i) => i.dueDate !== null);

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        className="px-6 py-3"
        title="My Work"
        description="What to do first, then everything open that is assigned to you."
      />
      <div data-scroll-container className="min-h-0 flex-1 overflow-auto">
        <TodayFocus
          focus={focus}
          canAsk={canAsk}
          nextDue={
            firstDated?.dueDate
              ? { name: firstDated.itemName, dueDate: firstDated.dueDate }
              : null
          }
        />
        <MyWorkList groups={groups} today={today} />
      </div>
    </div>
  );
}
