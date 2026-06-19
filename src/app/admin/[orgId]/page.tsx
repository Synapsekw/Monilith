import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requirePlatformAdmin } from "@/lib/platform/guard";
import { MembersTable } from "@/components/settings/members-table";
import { ActivityFeed } from "@/components/settings/activity-feed";

export const metadata = { title: "Platform admin · organization" };

export default async function AdminOrgPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const me = await requirePlatformAdmin();
  const { orgId } = await params;
  const supabase = await createClient();

  // get_org_members passes its gate via is_platform_admin() even cross-tenant.
  const { data: members } = await supabase.rpc("get_org_members", {
    p_org_id: orgId,
  });
  if (!members) notFound();

  const { data: audit } = await supabase
    .from("admin_audit_log")
    .select("id, action, target_email, created_at")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(50);

  return (
    <div className="space-y-10">
      <header>
        <h1 className="text-foreground font-heading text-xl font-semibold tracking-tight">
          Organization members
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Manage roles and access for this organization.
        </p>
      </header>

      {/* mode="platform" → canManage is always true; currentUserRole is unused
          for gating but required by the prop type. The RPC's is_platform_admin()
          gate + last-owner check are the real boundary. */}
      <MembersTable
        orgId={orgId}
        members={members}
        currentUserId={me.id}
        currentUserRole="owner"
        mode="platform"
      />

      <section className="space-y-3">
        <h2 className="text-foreground text-sm font-medium">Activity</h2>
        <ActivityFeed rows={audit ?? []} />
      </section>
    </div>
  );
}
