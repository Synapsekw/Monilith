import type { ReactNode } from "react";
import { Brand } from "@/components/brand/brand";
import { Sidebar } from "@/components/sidebar";
import { CommandTrigger } from "@/components/command-trigger";
import { ThemeToggle } from "@/components/theme-toggle";

type AppShellProps = {
  children: ReactNode;
  /** Streamed per-user sidebar nav (already Suspense-wrapped by the caller). */
  sidebarNav: ReactNode;
  /**
   * Streamed mobile nav — the hamburger + drawer shown below `md` (Suspense-
   * wrapped). Renders the same nav content as the desktop rail.
   */
  mobileNav: ReactNode;
  /** Streamed header user region — bell + account menu (Suspense-wrapped). */
  headerUser: ReactNode;
  /** Streamed command-palette data (Suspense-wrapped; hidden until opened). */
  commandPalette: ReactNode;
};

/**
 * Static application frame. Prerendered as part of the Cache Components shell:
 * sidebar chrome, header bar, command trigger and theme toggle paint instantly,
 * while the three data slots stream in behind their own Suspense boundaries.
 * The empty dock slot is part of the static frame too — see the comment on it.
 */
export function AppShell({
  children,
  sidebarNav,
  mobileNav,
  headerUser,
  commandPalette,
}: AppShellProps) {
  return (
    <div className="app-wash flex h-svh w-full overflow-hidden [&:has(#app-dock-slot:not(:empty))>div>main]:mr-1">
      <Sidebar navSlot={sidebarNav} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 px-4">
          <div className="flex items-center gap-1 md:hidden">
            {mobileNav}
            <Brand />
          </div>
          <div className="flex flex-1 items-center justify-end gap-2">
            <CommandTrigger />
            <ThemeToggle />
            {headerUser}
          </div>
        </header>
        <main className="bg-content-surface border-content-edge shadow-content-lift mr-2 mb-2 ml-1 min-h-0 flex-1 overflow-auto rounded-xl border">
          {children}
        </main>
      </div>
      {/* The board page's agent dock portals its <aside> in here (BoardDock.tsx),
          so the dock sits on the wash as the sidebar's twin — rail | card | dock —
          instead of inside the content card. Static and empty on purpose: no
          props, no request-time reads, so the prerendered shell is untouched
          (static-shell.test.ts). While it holds a dock, the root's `:has()`
          variant above narrows <main>'s right gutter to mr-1 — the dock's own
          `left-1` supplies the other 4px, matching the card's left side. */}
      <div id="app-dock-slot" className="flex shrink-0" />
      {commandPalette}
    </div>
  );
}
