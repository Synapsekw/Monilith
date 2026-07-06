import { redirect } from "next/navigation";
import { requireUser, getUserOrgs } from "@/lib/auth/session";
import { getUserTimeZoneCached } from "@/lib/profile/queries-cached";
import { createClient } from "@/lib/supabase/server";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { TimezoneForm } from "@/components/settings/timezone-form";
import { PersonalTimezoneForm } from "@/components/settings/personal-timezone-form";
import { ProfileForm } from "@/components/settings/profile-form";
import { DigestPreferenceForm } from "@/components/settings/DigestPreferenceForm";
import { OrgAdminConsole } from "@/components/settings/org-admin-console";
import { AiProviderForm } from "@/components/settings/AiProviderForm";
import { getMyAiCredential } from "@/lib/ai/credentials";
import { listWorkspacesCached } from "@/lib/workspaces/queries-cached";
import { WorkspaceNavItem } from "@/components/workspaces/WorkspaceNavItem";
import { NewWorkspaceDialog } from "@/components/workspaces/NewWorkspaceDialog";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = await requireUser();
  // Timezone + orgs + AI credential are independent reads — resolve them in
  // parallel (the members RPC below is the only read that depends on org.id).
  const [myTimeZone, orgs, aiCredential] = await Promise.all([
    getUserTimeZoneCached(user.id),
    getUserOrgs(),
    getMyAiCredential(),
  ]);
  const org = orgs[0];
  if (!org) redirect("/onboarding");

  const workspaces = await listWorkspacesCached(org.id);

  // First paint: members (bounded ~50 via the RPC), pending + declined invites,
  // and a bounded audit slice. Tab switches in the console are History-API only
  // (0 server round-trips) — see OrgAdminConsole / spec §12.
  const supabase = await createClient();
  const [{ data: members }, { data: myProfile }] = await Promise.all([
    supabase.rpc("get_org_members", { p_org_id: org.id }),
    supabase
      .from("profiles")
      .select("email_digest_opt_out, full_name")
      .eq("id", user.id)
      .maybeSingle(),
  ]);
  const me = (members ?? []).find((m) => m.user_id === user.id);
  const isAdmin = me?.role === "owner" || me?.role === "admin";

  const [{ data: invites }, { data: audit }] = isAdmin
    ? await Promise.all([
        supabase
          .from("org_invitations")
          .select("id, email, role, status, created_at")
          .eq("org_id", org.id)
          .in("status", ["pending", "declined"])
          .order("created_at", { ascending: false }),
        supabase
          .from("admin_audit_log")
          .select("id, action, target_email, created_at")
          .eq("org_id", org.id)
          .order("created_at", { ascending: false })
          .limit(50),
      ])
    : [{ data: [] }, { data: [] }];

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-8">
        <h1 className="text-foreground font-heading text-2xl font-semibold tracking-tight">
          Settings
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Manage your account and organization.
        </p>
      </div>

      {/* Personal (left) and organization (right) settings sit side by side on
          wide screens; they stack to a single column below `lg`. The heavier
          Members/admin console spans full width underneath. */}
      <div className="grid grid-cols-1 gap-x-6 gap-y-8 lg:grid-cols-2">
        <section
          aria-labelledby="settings-account-heading"
          className="space-y-4"
        >
          <h2
            id="settings-account-heading"
            className="text-muted-foreground px-1 text-xs font-semibold tracking-wider uppercase"
          >
            Your account
          </h2>

          <Card>
            <CardHeader>
              <CardTitle>Profile</CardTitle>
              <CardDescription>
                How you appear to your teammates.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ProfileForm currentFullName={myProfile?.full_name ?? null} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Preferences</CardTitle>
              <CardDescription>
                Personal settings for your account.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <PersonalTimezoneForm currentTimezone={myTimeZone} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Notifications</CardTitle>
              <CardDescription>
                In-app notifications are unaffected.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DigestPreferenceForm
                initialOptOut={myProfile?.email_digest_opt_out ?? false}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>AI</CardTitle>
              <CardDescription>
                {aiCredential
                  ? "Your AI provider key powers dashboard generation."
                  : "Not configured — add a provider key to enable AI features."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <AiProviderForm initial={aiCredential} />
            </CardContent>
          </Card>
        </section>

        <section aria-labelledby="settings-org-heading" className="space-y-4">
          <h2
            id="settings-org-heading"
            className="text-muted-foreground px-1 text-xs font-semibold tracking-wider uppercase"
          >
            Organization
          </h2>

          <Card>
            <CardHeader>
              <CardTitle>General</CardTitle>
              <CardDescription>
                General settings for your organization.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Org name — read-only */}
              <div className="space-y-1.5">
                <p className="text-sm font-medium">Name</p>
                <p className="text-muted-foreground bg-muted/40 rounded-md border px-3 py-2 text-sm">
                  {org.name}
                </p>
              </div>

              {/* Timezone form */}
              <TimezoneForm
                orgId={org.id}
                currentTimezone={org.timezone ?? "UTC"}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Workspaces</CardTitle>
              <CardDescription>
                Organize boards and dashboards. Rename or delete here; switch
                the active workspace from the sidebar.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between px-1 pb-2">
                <p className="text-muted-foreground text-xs font-medium">
                  {workspaces.length} workspace
                  {workspaces.length === 1 ? "" : "s"}
                </p>
                <NewWorkspaceDialog />
              </div>
              <div className="flex flex-col gap-0.5">
                {workspaces.map((w) => (
                  <WorkspaceNavItem
                    key={w.id}
                    workspace={w}
                    isOrgAdmin={isAdmin}
                    isLast={workspaces.length <= 1}
                  />
                ))}
              </div>
            </CardContent>
          </Card>
        </section>
      </div>

      {isAdmin && me && (
        <section
          aria-labelledby="settings-members-heading"
          className="mt-8 space-y-4"
        >
          <h2
            id="settings-members-heading"
            className="text-muted-foreground px-1 text-xs font-semibold tracking-wider uppercase"
          >
            Members
          </h2>
          <Card>
            <CardHeader>
              <CardTitle>Members</CardTitle>
              <CardDescription>
                Manage members, invitations, and activity.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <OrgAdminConsole
                orgId={org.id}
                members={members ?? []}
                invites={(invites ?? []).map((i) => ({
                  ...i,
                  status: i.status as "pending" | "declined",
                }))}
                audit={audit ?? []}
                currentUserId={user.id}
                currentUserRole={me.role}
              />
            </CardContent>
          </Card>
        </section>
      )}
    </div>
  );
}
