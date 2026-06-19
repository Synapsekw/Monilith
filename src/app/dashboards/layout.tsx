// react-grid-layout v2 ships a single stylesheet (includes resize-handle styles;
// the old react-resizable CSS no longer exists as a dependency).
import "react-grid-layout/css/styles.css";

import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { listBoards } from "@/lib/boards/queries";
import { listDashboards } from "@/lib/dashboards/queries";
import { requireUser, getUserOrgs } from "@/lib/auth/session";
import { isPlatformAdmin } from "@/lib/platform/guard";
import { createClient } from "@/lib/supabase/server";

/**
 * Persistent shell for every dashboard route. Mirrors the boards layout so the
 * sidebar renders identically across both surfaces; adds `dashboards` for the
 * sidebar's Dashboards section. The react-grid-layout CSS is imported here.
 */
export default async function DashboardsLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await requireUser();
  const supabase = await createClient();
  const [orgs, boards, dashboards, { data: workspaces }, platformAdmin] =
    await Promise.all([
      getUserOrgs(),
      listBoards(),
      listDashboards(),
      supabase.from("workspaces").select("id, name"),
      isPlatformAdmin(),
    ]);

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
      isPlatformAdmin={platformAdmin}
    >
      {children}
    </AppShell>
  );
}
