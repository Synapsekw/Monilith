import { getUser, getUserOrgs } from "@/lib/auth/session";
import {
  listMyBoardsCached,
  listSharedBoardsCached,
} from "@/lib/boards/queries-cached";
import { listDashboardsCached } from "@/lib/dashboards/queries-cached";
import { listWorkspacesCached } from "@/lib/workspaces/queries-cached";
import { getActiveWorkspaceId } from "@/lib/workspaces/active";
import { isOrgAdminCached } from "@/lib/org/guard";
import { SidebarNav } from "@/components/shell/sidebar-nav";
import type { ComponentProps } from "react";

type SidebarNavProps = ComponentProps<typeof SidebarNav>;

export async function getSidebarNavData(): Promise<
  Omit<SidebarNavProps, "forceExpanded">
> {
  const [user, orgs] = await Promise.all([getUser(), getUserOrgs()]);
  const userId = user?.id ?? "";
  const orgId = orgs[0]?.id ?? "";

  // Workspaces first: the active-workspace cookie is validated against this list,
  // and the resolved id scopes the board + dashboard reads below.
  const workspaces = await listWorkspacesCached(orgId);
  const activeWorkspaceId = await getActiveWorkspaceId(workspaces);

  const [boards, sharedBoards, dashboards, orgAdmin] = await Promise.all([
    listMyBoardsCached(userId, activeWorkspaceId),
    listSharedBoardsCached(userId),
    listDashboardsCached(orgId, activeWorkspaceId),
    isOrgAdminCached(userId, orgId),
  ]);

  return {
    boards,
    sharedBoards,
    workspaces,
    activeWorkspaceId,
    dashboards: dashboards.map((d) => ({ id: d.id, name: d.name })),
    isOrgAdmin: orgAdmin,
  };
}

/**
 * Streamed per-user sidebar nav data (desktop rail). Rendered behind a
 * <Suspense> boundary in the authenticated layout, so its awaits stream into
 * the static shell rather than blocking first paint.
 */
export async function SidebarNavData() {
  const data = await getSidebarNavData();
  return <SidebarNav {...data} />;
}
