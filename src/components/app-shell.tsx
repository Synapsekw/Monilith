import type { ReactNode } from "react";
import { Brand } from "@/components/brand/brand";
import { Sidebar } from "@/components/sidebar";
import { CommandTrigger } from "@/components/command-trigger";
import { ThemeToggle } from "@/components/theme-toggle";

type AppShellProps = {
  children: ReactNode;
  /** Streamed per-user sidebar nav (already Suspense-wrapped by the caller). */
  sidebarNav: ReactNode;
  /** Streamed header user region — bell + account menu (Suspense-wrapped). */
  headerUser: ReactNode;
  /** Streamed command-palette data (Suspense-wrapped; hidden until opened). */
  commandPalette: ReactNode;
};

/**
 * Static application frame. Prerendered as part of the Cache Components shell:
 * sidebar chrome, header bar, command trigger and theme toggle paint instantly,
 * while the three data slots stream in behind their own Suspense boundaries.
 */
export function AppShell({
  children,
  sidebarNav,
  headerUser,
  commandPalette,
}: AppShellProps) {
  return (
    <div className="flex h-svh w-full overflow-hidden">
      <Sidebar navSlot={sidebarNav} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b px-4">
          <div className="md:hidden">
            <Brand />
          </div>
          <div className="flex flex-1 items-center justify-end gap-2">
            <CommandTrigger />
            <ThemeToggle />
            {headerUser}
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-auto">{children}</main>
      </div>
      {commandPalette}
    </div>
  );
}
