import { requireUser } from "@/lib/auth/session";
import { isOrgAdmin } from "@/lib/org/guard";
import { getWorkloadPageData } from "@/lib/workload/queries";
import { WorkloadGrid } from "@/components/workload/WorkloadGrid";

export default async function WorkloadPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const [user, sp] = await Promise.all([requireUser(), searchParams]);

  // from/to in the URL only changes when paging BEYOND the loaded horizon (rare,
  // genuine RSC nav for more data). In-window sort/pan/filter/metric is
  // client-side over the raw payload, 0 refetch.
  const [data, orgAdmin] = await Promise.all([
    getWorkloadPageData({ from: sp.from, to: sp.to }),
    isOrgAdmin(),
  ]);

  return (
    <WorkloadGrid
      rawRows={data.rawRows}
      actuals={data.actuals}
      members={data.members}
      capacities={data.capacities}
      defaults={data.defaults}
      boards={data.boards}
      workspaces={data.workspaces}
      today={data.today}
      weeksBack={data.weeksBack}
      weeksFwd={data.weeksFwd}
      weekStartsOn={data.weekStartsOn}
      currentUserId={user.id}
      isOrgAdmin={orgAdmin}
    />
  );
}
