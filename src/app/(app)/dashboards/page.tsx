import { PageHeader } from "@/components/ui/page-header";
import { FolderGallery } from "@/components/folders/FolderGallery";
import { UnfiledDashboards } from "@/components/folders/UnfiledDashboards";
import { requireUser } from "@/lib/auth/session";
import { getActiveOrgId } from "@/lib/org/active";
import { listWorkspacesCached } from "@/lib/workspaces/queries-cached";
import { getActiveWorkspaceId } from "@/lib/workspaces/active";
import { createClient } from "@/lib/supabase/server";
import { resolveFolderGallery } from "@/lib/folders/resolve";
import { listUnfiledDashboards } from "@/lib/folders/queries";
import { listFoldersCached } from "@/lib/folders/queries-cached";
import { EmptyState } from "@/components/ui/empty-state";

/** The folder gallery (spec §4): one folder_gallery RPC + one bounded unfiled read + the warm cached folder list. */
export default async function DashboardsIndex() {
  await requireUser();
  const orgId = await getActiveOrgId();
  const workspaceId = await getActiveWorkspaceId(
    await listWorkspacesCached(orgId),
  );
  if (!workspaceId)
    return (
      <EmptyState className="m-6">
        Create a workspace to see folders.
      </EmptyState>
    );
  const supabase = await createClient();
  const [gallery, unfiled, nav] = await Promise.all([
    resolveFolderGallery(supabase, workspaceId),
    listUnfiledDashboards(supabase, workspaceId),
    listFoldersCached(orgId, workspaceId),
  ]);
  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <PageHeader
        kicker="Workspace"
        title="Folders"
        description="Every folder is a project with its own command center."
      />
      {gallery.ok ? (
        <FolderGallery rows={gallery.rows} workspaceId={workspaceId} />
      ) : (
        <EmptyState>Couldn&apos;t load folders. {gallery.error}</EmptyState>
      )}
      <UnfiledDashboards
        workspaceId={workspaceId}
        dashboards={unfiled}
        folders={(nav?.folders ?? []).map((f) => ({ id: f.id, name: f.name }))}
      />
    </div>
  );
}
