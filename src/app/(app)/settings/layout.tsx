import { Suspense, type ReactNode } from "react";
import { Kicker } from "@/components/ui/kicker";
import { SettingsNav } from "@/components/settings/settings-nav";
import { SettingsNavData } from "./settings-nav-data";
import { settingsNavGroups } from "./settings-nav-groups";

export const metadata = { title: "Settings" };

/**
 * Shared settings shell: static header + nav chrome around the section.
 *
 * NOT async, and it must stay that way. This layout renders above every
 * Suspense boundary of the settings routes (`loading.tsx` wraps the layout's
 * CHILDREN, not the layout), so anything awaited here leaves every
 * `settings/*` page with an EMPTY prerendered shell and holds its first byte
 * until the read returns. It used to await the user, the active org and the
 * admin flag right here — two sequential round-trips before a single byte.
 * `src/test/static-shell.test.ts` guards the shape.
 *
 * The one per-user part of the chrome — whether the admin-gated Members entry
 * shows — streams in through `SettingsNavData`, which also carries the
 * no-organization redirect. Its fallback is the same nav minus that entry, so
 * the navigation is on screen and usable from the first paint and nothing
 * shifts when the role lands (an admin sees one link appear). Hiding the link
 * is cosmetic: each admin-only page enforces access itself on the server.
 */
export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="w-full px-6 py-10 lg:px-8">
      <div className="mb-8">
        <Kicker className="mb-1.5 block">ADMIN</Kicker>
        <h1 className="text-foreground font-heading text-xl font-bold tracking-[-0.02em]">
          Settings
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Manage your account, organization and integrations.
        </p>
      </div>

      <div className="flex flex-col gap-8 lg:flex-row lg:gap-12">
        <aside className="lg:w-56 lg:shrink-0">
          <Suspense
            fallback={<SettingsNav groups={settingsNavGroups(false)} />}
          >
            <SettingsNavData />
          </Suspense>
        </aside>
        <main className="min-w-0 flex-1 lg:max-w-3xl">{children}</main>
      </div>
    </div>
  );
}
