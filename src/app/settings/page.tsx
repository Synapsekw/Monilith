import { redirect } from "next/navigation";
import { requireUser, getUserOrgs } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { TimezoneForm } from "@/components/settings/timezone-form";
import { OrgAdminConsole } from "@/components/settings/org-admin-console";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = await requireUser();
  const orgs = await getUserOrgs();
  const org = orgs[0];
  if (!org) redirect("/onboarding");

  // First paint: members (bounded ~50 via the RPC), pending invites, and a
  // bounded audit slice. Tab switches in the console are History-API only
  // (0 server round-trips) — see OrgAdminConsole / spec §12.
  const supabase = await createClient();
  const { data: members } = await supabase.rpc("get_org_members", {
    p_org_id: org.id,
  });
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
    <div className="mx-auto max-w-3xl px-6 py-10">
      <div className="mb-8">
        <h1 className="text-foreground font-heading text-2xl font-semibold tracking-tight">
          Settings
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Manage your organization preferences.
        </p>
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Organization</CardTitle>
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

        {isAdmin && me && (
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
        )}
      </div>
    </div>
  );
}
