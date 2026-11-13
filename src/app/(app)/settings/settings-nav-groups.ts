import type { SettingsNavGroup } from "@/components/settings/settings-nav";

/**
 * The settings sub-navigation. Pure, so the layout can render the non-admin
 * form of it into the static shell and `SettingsNavData` can swap in the real
 * one once the caller's role is known.
 *
 * `isAdmin` only decides whether the Members LINK is shown. It is never the
 * access check: `/settings/members` re-derives the caller's role on the server
 * and 404s a non-admin, and the admin-only sections of the other pages gate
 * themselves the same way.
 */
export function settingsNavGroups(isAdmin: boolean): SettingsNavGroup[] {
  return [
    {
      label: "Account",
      items: [
        { href: "/settings/profile", label: "Profile" },
        { href: "/settings/preferences", label: "Preferences" },
        { href: "/settings/notifications", label: "Notifications" },
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
        { href: "/settings/desktop", label: "Desktop app" },
      ],
    },
  ];
}
