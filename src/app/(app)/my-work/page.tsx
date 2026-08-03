import { requireUser } from "@/lib/auth/session";
import { getMyWorkPageData } from "@/lib/my-work/queries";
import { MyWorkList } from "@/components/my-work/MyWorkList";

/**
 * "My Work" — the primary persona's #1 job: everything assigned to me across
 * every board, grouped by when it's due. A pure server-side read of server data
 * (RSC): the grouped list has no in-page toggles, so it needs no client state.
 * Each row deep-links to the item on its board via `?item=` (opens the
 * ItemPanel) — see MyWorkList.
 */
export default async function MyWorkPage() {
  await requireUser();
  const { today, groups } = await getMyWorkPageData();

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-6 py-3">
        <div>
          <h1 className="text-lg font-semibold">My Work</h1>
          <p className="text-muted-foreground text-xs">
            Everything assigned to you across every board, by when it&apos;s
            due.
          </p>
        </div>
      </div>
      <div data-scroll-container className="min-h-0 flex-1 overflow-auto">
        <MyWorkList groups={groups} today={today} />
      </div>
    </div>
  );
}
