import { getUser, getUserOrgs } from "@/lib/auth/session";
import {
  listMyBoardsCached,
  listSharedBoardsCached,
} from "@/lib/boards/queries-cached";
import { listDashboardsCached } from "@/lib/dashboards/queries-cached";
import { listWorkspacesCached } from "@/lib/workspaces/queries-cached";
import { isPlatformAdminCached } from "@/lib/platform/guard";
import { isOrgAdminCached } from "@/lib/org/guard";
import { countNewFeedback } from "@/lib/feedback/queries";
import { SidebarNav } from "@/components/shell/sidebar-nav";

/**
 * Streamed per-user sidebar nav data. Rendered behind a <Suspense> boundary in
 * the authenticated layout, so its awaits stream into the static shell rather
 * than blocking first paint. Identity (userId/orgId) is read OUTSIDE any cache
 * via the cookie-bound session helpers, then passed into the `use cache` reads
 * (Phase 9.3) so cross-section navigation serves the cached lists instead of
 * re-hitting Supabase.
 */
export async function SidebarNavData() {
  // Identity read OUTSIDE any cache (cookie-bound, uncached). getClaims is local
  // (9.1), so this is cheap. The cached reads below take these ids as args.
  const [user, orgs] = await Promise.all([getUser(), getUserOrgs()]);
  const userId = user?.id ?? "";
  const orgId = orgs[0]?.id ?? "";

  const [
    boards,
    sharedBoards,
    dashboards,
    workspaces,
    platformAdmin,
    orgAdmin,
  ] = await Promise.all([
    listMyBoardsCached(userId),
    listSharedBoardsCached(userId),
    listDashboardsCached(orgId),
    listWorkspacesCached(orgId),
    isPlatformAdminCached(userId),
    isOrgAdminCached(userId, orgId),
  ]);

  // Only fetch the new-feedback count for platform admins — avoids an
  // unnecessary RLS-gated query for regular users (it would return 0 anyway).
  const newFeedbackCount = platformAdmin ? await countNewFeedback() : 0;

  return (
    <SidebarNav
      boards={boards}
      sharedBoards={sharedBoards}
      workspaces={workspaces}
      dashboards={dashboards.map((d) => ({ id: d.id, name: d.name }))}
      isPlatformAdmin={platformAdmin}
      isOrgAdmin={orgAdmin}
      newFeedbackCount={newFeedbackCount}
    />
  );
}
