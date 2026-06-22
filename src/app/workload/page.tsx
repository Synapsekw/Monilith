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
  // genuine RSC nav for more data). In-window sort/pan is client-side, 0 refetch.
  const [{ grid, capacities, defaults }, orgAdmin] = await Promise.all([
    getWorkloadPageData({ from: sp.from, to: sp.to }),
    isOrgAdmin(),
  ]);

  return (
    <WorkloadGrid
      grid={grid}
      currentUserId={user.id}
      isOrgAdmin={orgAdmin}
      capacities={capacities}
      defaults={defaults}
    />
  );
}
