import { Suspense, type ReactNode } from "react";
import { Menu } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { SidebarNavData } from "@/components/shell/sidebar-nav-data";
import { MobileNavData } from "@/components/shell/mobile-nav-data";
import { HeaderUserData } from "@/components/shell/header-user-data";
import { CommandPaletteData } from "@/components/shell/command-palette-data";
import { SidebarNavSkeleton } from "@/components/shell/sidebar-nav-skeleton";
import { HeaderUserSkeleton } from "@/components/shell/header-user-skeleton";
import { getUser } from "@/lib/auth/session";
import { getUserTimeZoneCached } from "@/lib/profile/queries-cached";
import { TimeZoneProvider } from "@/lib/datetime/timezone-context";
import { Button } from "@/components/ui/button";

/**
 * Resolve the user's timezone as a promise passed UNAWAITED into the client
 * provider so page content paints immediately — only the `DateTime` primitive
 * suspends on it (behind its own empty <time> fallback). Identity is read
 * OUTSIDE the cache (cookie-bound `getUser`) and threaded into the `use cache`
 * read, so the value is shared across routes and invalidated by
 * `updateTag(profileTag(userId))` on save (Phase 9.3 rule).
 */
function resolveUserTimeZone(): Promise<string | null> {
  return getUser().then((user) =>
    user ? getUserTimeZoneCached(user.id) : null,
  );
}

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
 * shell); the three per-user data slots stream in. The timezone is streamed as
 * an unawaited promise so it never blocks the content area — see
 * resolveUserTimeZone above.
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
      <TimeZoneProvider timeZone={resolveUserTimeZone()}>
        {children}
      </TimeZoneProvider>
    </AppShell>
  );
}
