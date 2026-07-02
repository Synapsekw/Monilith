import { redirect } from "next/navigation";
import { getUserOrgs } from "@/lib/auth/session";
import { listDashboardsCached } from "@/lib/dashboards/queries-cached";

export default async function DashboardsIndex() {
  // Identity read OUTSIDE the cache (9.3 rule); the sidebar calls
  // listDashboardsCached with the same key, so this is a warm hit.
  const orgs = await getUserOrgs();
  const orgId = orgs[0]?.id;
  const dashboards = orgId ? await listDashboardsCached(orgId) : [];
  if (dashboards.length > 0) redirect(`/dashboards/${dashboards[0].id}`);
  return (
    <div className="text-muted-foreground flex h-full items-center justify-center p-12 text-sm">
      No dashboards yet. Create one from the sidebar.
    </div>
  );
}
