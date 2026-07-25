import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { resolveActiveOrg } from "@/lib/org/active";
import { isOrgAdminCached } from "@/lib/org/guard";
import { listWorkspacesCached } from "@/lib/workspaces/queries-cached";
import { SettingsSection } from "@/components/settings/settings-section";
import { WorkspaceNavItem } from "@/components/workspaces/WorkspaceNavItem";
import { NewWorkspaceDialog } from "@/components/workspaces/NewWorkspaceDialog";

export const metadata = { title: "Workspaces · Settings" };

export default async function WorkspacesSettingsPage() {
  const user = await requireUser();
  const org = await resolveActiveOrg();
  if (!org) redirect("/onboarding");
  const [workspaces, isAdmin] = await Promise.all([
    listWorkspacesCached(org.id),
    isOrgAdminCached(user.id, org.id),
  ]);

  return (
    <SettingsSection
      title="Workspaces"
      description="Organize boards and dashboards. Rename or delete here; switch the active workspace from the sidebar."
    >
      <div className="border-border flex items-center justify-between border-b py-4">
        <p className="text-muted-foreground text-sm">
          {workspaces.length} workspace{workspaces.length === 1 ? "" : "s"}
        </p>
        <NewWorkspaceDialog />
      </div>
      <div className="flex flex-col gap-0.5 pt-3">
        {workspaces.map((w) => (
          <WorkspaceNavItem
            key={w.id}
            workspace={w}
            isOrgAdmin={isAdmin}
            isLast={workspaces.length <= 1}
          />
        ))}
      </div>
    </SettingsSection>
  );
}
