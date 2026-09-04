import { getUser, getUserOrgs } from "@/lib/auth/session";
import {
  listMyBoardsCached,
  listSharedBoardsCached,
} from "@/lib/boards/queries-cached";
import { listDashboardsCached } from "@/lib/dashboards/queries-cached";
import { listBoardFoldersCached } from "@/lib/boards/folders/queries-cached";
import { listWorkspacesCached } from "@/lib/workspaces/queries-cached";
import { getActiveWorkspaceId } from "@/lib/workspaces/active";
import { resolveActiveOrg } from "@/lib/org/active";
import { SidebarNav } from "@/components/shell/sidebar-nav";
import type { ComponentProps } from "react";

type SidebarNavProps = ComponentProps<typeof SidebarNav>;

export async function getSidebarNavData(): Promise<
  Omit<SidebarNavProps, "forceExpanded">
> {
  const [user, orgs] = await Promise.all([getUser(), getUserOrgs()]);
  const userId = user?.id ?? "";
  const activeOrg = await resolveActiveOrg(); // cache-deduped with getUserOrgs above
  const orgId = activeOrg?.id ?? "";

  // Workspaces first: the active-workspace cookie is validated against this list
  // (and self-heals if it points at a workspace in a different org).
  const workspaces = await listWorkspacesCached(orgId);
  const activeWorkspaceId = await getActiveWorkspaceId(workspaces);

  // Folders join the EXISTING Promise.all — a sequential await here would add a
  // round-trip to first paint of every authenticated route.
  const [boards, sharedBoards, dashboards, folderData] = await Promise.all([
    listMyBoardsCached(userId, activeWorkspaceId),
    listSharedBoardsCached(userId),
    listDashboardsCached(orgId, activeWorkspaceId),
    listBoardFoldersCached(userId),
  ]);

  return {
    orgs,
    activeOrgId: orgId,
    boards,
    sharedBoards,
    // `folderData` is null when the folders read FAILED. Spreading `?.` here
    // hands `undefined` down, which makes `SidebarNav`/`BoardsNav` fall back to
    // their `NO_FOLDERS` sentinel — the one place that already means "no folder
    // data was supplied", as opposed to "this user has no folders". That
    // sentinel is what stops the prune effect wiping every persisted folder
    // collapse key on a one-off Supabase blip.
    folders: folderData?.folders,
    placements: folderData?.placements,
    workspaces,
    activeWorkspaceId,
    dashboards: dashboards.map((d) => ({ id: d.id, name: d.name })),
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
