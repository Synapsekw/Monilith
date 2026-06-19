import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { listBoards } from "@/lib/boards/queries";
import { listDashboards } from "@/lib/dashboards/queries";
import { requireUser, getUserOrgs } from "@/lib/auth/session";
import { isPlatformAdmin } from "@/lib/platform/guard";
import { createClient } from "@/lib/supabase/server";

/**
 * Persistent shell for every board route. Next.js 16 preserves a shared layout
 * across navigation between sibling dynamic segments (`/boards/A → /boards/B`),
 * so these shell queries run once and are NOT re-fetched on board switch — the
 * sidebar stays mounted and only the page segment re-renders.
 */
export default async function BoardsLayout({
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
