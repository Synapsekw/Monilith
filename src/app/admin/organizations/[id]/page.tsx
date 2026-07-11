import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requirePlatformAdmin } from "@/lib/platform/guard";
import { readOrgAiSettings } from "@/lib/ai/org-settings";
import { MembersTable } from "@/components/settings/members-table";
import { ActivityFeed } from "@/components/settings/activity-feed";
import { OrgAiPlanForm } from "@/components/admin/OrgAiPlanForm";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";

export const metadata = { title: "Platform admin · organization" };

export default async function AdminOrgPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const me = await requirePlatformAdmin();
  const { id: orgId } = await params;
  const supabase = await createClient();

  // These two reads are independent (audit doesn't depend on members) — fetch
  // them concurrently instead of in a waterfall. The not-found guard still runs
  // after both resolve, so behavior is unchanged.
  // AI settings read via the SERVICE client: a platform admin may not be a
  // member of this org, so RLS would hide the row from the request client.
  const [{ data: members }, { data: audit }, aiSettings] = await Promise.all([
    supabase.rpc("get_org_members", { p_org_id: orgId }),
    supabase
      .from("admin_audit_log")
      .select("id, action, target_email, created_at")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })
      .limit(50),
    readOrgAiSettings(createServiceClient(), orgId),
  ]);
  if (!members) notFound();

  return (
    <div className="space-y-8">
      <header>
        <Link
          href="/admin/organizations"
          className="text-primary text-xs font-medium"
        >
          ← Organizations
        </Link>
        <h1 className="text-foreground font-heading mt-2 text-xl font-semibold tracking-tight">
          Organization members
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Manage roles and access for this organization.
        </p>
      </header>

      <MembersTable
        orgId={orgId}
        members={members}
        currentUserId={me.id}
        currentUserRole="owner"
        mode="platform"
      />

      <Card>
        <CardHeader>
          <CardTitle>AI plan</CardTitle>
          <CardDescription>
            Grant this organization&rsquo;s AI allowance. The org&rsquo;s own
            admins choose how to use it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <OrgAiPlanForm
            orgId={orgId}
            initial={{
              tier: aiSettings.tier,
              monthlyCreditLimit: aiSettings.monthlyCreditLimit,
              mode: aiSettings.mode,
            }}
          />
        </CardContent>
      </Card>

      <section className="space-y-3">
        <h2 className="text-foreground text-sm font-medium">Activity</h2>
        <ActivityFeed rows={audit ?? []} />
      </section>
    </div>
  );
}
