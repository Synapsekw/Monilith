import { listMyBoards, listSharedBoards } from "@/lib/boards/queries";
import { listDashboards } from "@/lib/dashboards/queries";
import { createClient } from "@/lib/supabase/server";
import { isPlatformAdmin } from "@/lib/platform/guard";
import { isOrgAdmin } from "@/lib/org/guard";
import { countNewFeedback } from "@/lib/feedback/queries";
import { SidebarNav } from "@/components/shell/sidebar-nav";

/**
 * Streamed per-user sidebar nav data. Rendered behind a <Suspense> boundary in
 * the authenticated layout, so its awaits stream into the static shell rather
 * than blocking first paint. NOT cached (the session reads cookies → `use cache`
 * is disallowed; caching the per-user nav is Phase 9.3's job).
 */
export async function SidebarNavData() {
  const supabase = await createClient();
  const [
    boards,
    sharedBoards,
    dashboards,
    { data: workspaces },
    platformAdmin,
    orgAdmin,
  ] = await Promise.all([
    listMyBoards(),
    listSharedBoards(),
    listDashboards(),
    supabase.from("workspaces").select("id, name"),
    isPlatformAdmin(),
    isOrgAdmin(),
  ]);

  // Only fetch the new-feedback count for platform admins — avoids an
  // unnecessary RLS-gated query for regular users (it would return 0 anyway).
  const newFeedbackCount = platformAdmin ? await countNewFeedback() : 0;

  return (
    <SidebarNav
      boards={boards}
      sharedBoards={sharedBoards}
      workspaces={workspaces ?? []}
      dashboards={dashboards.map((d) => ({ id: d.id, name: d.name }))}
      isPlatformAdmin={platformAdmin}
      isOrgAdmin={orgAdmin}
      newFeedbackCount={newFeedbackCount}
    />
  );
}
