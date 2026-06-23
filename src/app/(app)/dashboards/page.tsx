import { redirect } from "next/navigation";
import { listDashboards } from "@/lib/dashboards/queries";

export default async function DashboardsIndex() {
  const dashboards = await listDashboards();
  if (dashboards.length > 0) redirect(`/dashboards/${dashboards[0].id}`);
  return (
    <div className="text-muted-foreground flex h-full items-center justify-center p-12 text-sm">
      No dashboards yet. Create one from the sidebar.
    </div>
  );
}
