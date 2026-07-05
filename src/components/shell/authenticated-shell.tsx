import { Suspense, type ReactNode } from "react";
import { Menu } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { SidebarNavData } from "@/components/shell/sidebar-nav-data";
import { MobileNavData } from "@/components/shell/mobile-nav-data";
import { HeaderUserData } from "@/components/shell/header-user-data";
import { CommandPaletteData } from "@/components/shell/command-palette-data";
import { TimeZoneBoundary } from "@/components/shell/timezone-boundary";
import { SidebarNavSkeleton } from "@/components/shell/sidebar-nav-skeleton";
import { HeaderUserSkeleton } from "@/components/shell/header-user-skeleton";
import { Button } from "@/components/ui/button";

/**
 * Static fallback for the mobile hamburger while its nav data streams in: a
 * disabled trigger so the button paints instantly with the rest of the shell.
 */
function MobileNavFallback() {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      disabled
      aria-label="Open navigation menu"
      className="text-muted-foreground md:hidden"
    >
      <Menu className="size-5" />
    </Button>
  );
}

/**
 * The single composition every authenticated section layout shares. The frame
 * and skeleton fallbacks are static (prerendered into the Cache Components
 * shell); the three per-user data slots and the timezone boundary stream in.
 */
export function AuthenticatedShell({ children }: { children: ReactNode }) {
  return (
    <AppShell
      sidebarNav={
        <Suspense fallback={<SidebarNavSkeleton />}>
          <SidebarNavData />
        </Suspense>
      }
      mobileNav={
        <Suspense fallback={<MobileNavFallback />}>
          <MobileNavData />
        </Suspense>
      }
      headerUser={
        <Suspense fallback={<HeaderUserSkeleton />}>
          <HeaderUserData />
        </Suspense>
      }
      commandPalette={
        <Suspense fallback={null}>
          <CommandPaletteData />
        </Suspense>
      }
    >
      <Suspense fallback={null}>
        <TimeZoneBoundary>{children}</TimeZoneBoundary>
      </Suspense>
    </AppShell>
  );
}
