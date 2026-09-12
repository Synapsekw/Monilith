import type { ReactNode } from "react";
import { Brand } from "@/components/brand/brand";
import { Sidebar } from "@/components/sidebar";
import { SidebarSeam } from "@/components/shell/sidebar-seam";
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
    <div className="app-wash flex h-svh w-full overflow-hidden [&:has(#app-dock-slot:not(:empty))_#app-card-frame]:mr-1">
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
        {/* The card gets a positioned FRAME of its own so the lit seam can lay
            itself over the card's outline (CardSeam is `absolute inset-0`).
            The frame carries the gutter; <main> fills it and keeps its own
            radius, border, shadow and scrolling, so nothing that measures or
            scrolls inside the card changes. The root's dock variant above
            narrows this frame, not <main>. */}
        <div
          id="app-card-frame"
          className="relative mr-2 mb-2 ml-1 min-h-0 min-w-0 flex-1"
        >
          <main className="bg-content-surface border-content-edge shadow-content-lift absolute inset-0 overflow-auto rounded-xl border">
            {children}
          </main>
          <SidebarSeam />
          {/* The board dock portals its own seam here (DockSeam.tsx) so the
              card's right edge folds the dock the way the left edge folds the
              rail. Static and empty on purpose, exactly like #app-dock-slot. */}
          <div id="card-seam-slot" />
        </div>
      </div>
      {/* The board page's agent dock portals its <aside> in here (BoardDock.tsx),
          so the dock sits on the wash as the sidebar's twin — rail | card | dock —
          instead of inside the content card. Static and empty on purpose: no
          props, no request-time reads, so the prerendered shell is untouched
          (static-shell.test.ts). While it holds a dock, the root's `:has()`
          variant above narrows <main>'s right gutter to mr-1 — 4px, which IS
          the gutter, matching the card's own `ml-1` on the left. (The dock
          used to inset its layers a further `left-1`, making it 8px.) */}
      <div id="app-dock-slot" className="flex shrink-0" />
      {commandPalette}
    </div>
  );
}
