import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { listBoards } from "@/lib/boards/queries";
import { listDashboards } from "@/lib/dashboards/queries";
import { getUserOrgs } from "@/lib/auth/session";
import { requirePlatformAdmin } from "@/lib/platform/guard";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Platform admin" };

export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  // The gate: redirects non-admins; never reveals the route (see guard.ts).
  const user = await requirePlatformAdmin();
  const supabase = await createClient();
  const [orgs, boards, dashboards, { data: workspaces }] = await Promise.all([
    getUserOrgs(),
    listBoards(),
    listDashboards(),
    supabase.from("workspaces").select("id, name"),
  ]);

  // Render the admin console INSIDE the app shell so the collapsible Platform
  // sidebar section is present on every /admin page (we're past the gate, so the
  // viewer is a platform admin → isPlatformAdmin is true).
  return (
    <AppShell
      currentUserId={user.id}
      user={{
        email: user.email,
        full_name:
          typeof user.user_metadata?.full_name === "string"
            ? user.user_metadata.full_name
            : null,
      }}
      org={{ name: orgs[0]?.name ?? "Pulse" }}
      workspaces={workspaces ?? []}
      boards={boards}
      dashboards={dashboards.map((d) => ({ id: d.id, name: d.name }))}
      isPlatformAdmin
    >
      <div className="mx-auto max-w-5xl px-6 py-10">{children}</div>
    </AppShell>
  );
}
