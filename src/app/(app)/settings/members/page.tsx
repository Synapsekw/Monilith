import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { resolveActiveOrg } from "@/lib/org/active";
import { createClient } from "@/lib/supabase/server";
import { SettingsSection } from "@/components/settings/settings-section";
import { OrgAdminConsole } from "@/components/settings/org-admin-console";

export const metadata = { title: "Members · Settings" };

/**
 * The heavy reads of the old combined settings page now live here, and only
 * run when this route is opened: the members RPC, pending/declined invites,
 * and a bounded 50-row audit slice.
 *
 * Console tab switches are History-API only (0 server round-trips) — see
 * OrgAdminConsole.
 */
export default async function MembersSettingsPage() {
  const user = await requireUser();
  const org = await resolveActiveOrg();
  if (!org) redirect("/onboarding");

  const supabase = await createClient();
  const { data: members } = await supabase.rpc("get_org_members", {
    p_org_id: org.id,
  });
  const me = (members ?? []).find((m) => m.user_id === user.id);
  const isAdmin = me?.role === "owner" || me?.role === "admin";
  if (!me || !isAdmin) notFound();

  const [{ data: invites }, { data: audit }] = await Promise.all([
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
  ]);

  return (
    <SettingsSection
      title="Members"
      description="Manage members, invitations, and activity."
    >
      <div className="pt-4">
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
      </div>
    </SettingsSection>
  );
}
