import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { resolveActiveOrg } from "@/lib/org/active";
import { isOrgAdminCached } from "@/lib/org/guard";
import { Kicker } from "@/components/ui/kicker";
import {
  SettingsNav,
  type SettingsNavGroup,
} from "@/components/settings/settings-nav";

export const metadata = { title: "Settings" };

/**
 * Shared settings shell. Owns the only three reads every section needs — user,
 * active org, admin flag — so each section route can fetch just its own data.
 * Visiting one section no longer pays for all of them.
 *
 * Uses isOrgAdminCached (a narrow, tagged org_members role lookup) rather than
 * isOrgAdmin(), which derives the role from the get_org_members RPC and would
 * drag that heavy query onto every settings page.
 */
export default async function SettingsLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await requireUser();
  const org = await resolveActiveOrg();
  if (!org) redirect("/onboarding");
  const isAdmin = await isOrgAdminCached(user.id, org.id);

  const groups: SettingsNavGroup[] = [
    {
      label: "Account",
      items: [
        { href: "/settings/profile", label: "Profile" },
        { href: "/settings/preferences", label: "Preferences" },
        { href: "/settings/notifications", label: "Notifications" },
        { href: "/settings/agents", label: "Agents" },
        { href: "/settings/security", label: "Security" },
      ],
    },
    {
      label: "Organization",
      items: [
        { href: "/settings/organization", label: "General" },
        { href: "/settings/workspaces", label: "Workspaces" },
        ...(isAdmin ? [{ href: "/settings/members", label: "Members" }] : []),
      ],
    },
    {
      label: "Integrations",
      items: [
        { href: "/settings/ai", label: "AI" },
        { href: "/settings/mcp", label: "Connect via MCP" },
      ],
    },
  ];

  return (
    <div className="w-full px-6 py-10 lg:px-8">
      <div className="mb-8">
        <Kicker className="mb-1.5 block">ADMIN</Kicker>
        <h1 className="text-foreground font-heading text-2xl font-semibold tracking-tight">
          Settings
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Manage your account, organization and integrations.
        </p>
      </div>

      <div className="flex flex-col gap-8 lg:flex-row lg:gap-12">
        <aside className="lg:w-56 lg:shrink-0">
          <SettingsNav groups={groups} />
        </aside>
        <main className="min-w-0 flex-1 lg:max-w-3xl">{children}</main>
      </div>
    </div>
  );
}
