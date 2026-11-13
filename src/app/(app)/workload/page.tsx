import { requireUser } from "@/lib/auth/session";
import { getActiveOrgId } from "@/lib/org/active";
import { isOrgAdminCached } from "@/lib/org/guard";
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
  //
  // The admin flag is the narrow, tagged `org_members` role lookup
  // (isOrgAdminCached), not isOrgAdmin(): that one derives a boolean from the
  // whole get_org_members RPC. `getActiveOrgId` is request-memoised and
  // getWorkloadPageData resolves it too, so it adds no round-trip. The flag
  // only decides which controls render — RLS is the boundary on the writes.
  const [data, orgAdmin] = await Promise.all([
    getWorkloadPageData({ from: sp.from, to: sp.to }),
    getActiveOrgId().then((orgId) =>
      orgId ? isOrgAdminCached(user.id, orgId) : false,
    ),
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
