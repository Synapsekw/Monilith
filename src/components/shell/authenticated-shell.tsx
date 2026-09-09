import { Suspense, type ReactNode } from "react";
import { cookies } from "next/headers";
import { Menu } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { SidebarNavData } from "@/components/shell/sidebar-nav-data";
import { MobileNavData } from "@/components/shell/mobile-nav-data";
import { HeaderUserData } from "@/components/shell/header-user-data";
import { CommandPaletteData } from "@/components/shell/command-palette-data";
import { SidebarNavSkeleton } from "@/components/shell/sidebar-nav-skeleton";
import { HeaderUserSkeleton } from "@/components/shell/header-user-skeleton";
import { getUser } from "@/lib/auth/session";
import {
  getUserThemePresetCached,
  getUserTimeZoneCached,
} from "@/lib/profile/queries-cached";
import { ThemePresetSync } from "@/components/theme-preset-sync";
import { DEFAULT_THEME_PRESET, type ThemePresetId } from "@/lib/theme/presets";
import { TimeZoneProvider } from "@/lib/datetime/timezone-context";
import {
  DEVICE_TZ_COOKIE,
  DeviceTimeZoneProvider,
} from "@/lib/datetime/device-timezone";
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

/** Same unawaited-promise shape as the timezone above: ThemePresetSync is the
 *  only thing that suspends on it, behind a null fallback, so the account's
 *  preset corrects the device's localStorage without delaying any paint. */
function resolveUserThemePreset(): Promise<ThemePresetId> {
  return getUser().then((user) =>
    user ? getUserThemePresetCached(user.id) : DEFAULT_THEME_PRESET,
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
 * The device-zone cookie, read WITHOUT awaiting. This function runs above every
 * Suspense boundary in the `(app)` group, so a single `await cookies()` here
 * makes the whole route dynamic and the prerendered static shell EMPTY — that
 * regression shipped and left `.next/server/app/my-work.html`,
 * `boards/[boardId].html` and every `settings/*.html` at 0 bytes (a cold load
 * then painted nothing until the server had rendered the layout;
 * route-level `loading.tsx` only covers client navigation). The promise is
 * handed to `DeviceTimeZoneProvider`, which stores it in context untouched and
 * lets the `DateTime` consumer resolve it with React `use`. Same
 * unawaited-promise shape as the timezone and theme preset above.
 * `src/test/static-shell.test.ts` guards this.
 */
function resolveDeviceTimeZone(): Promise<string | null> {
  return cookies().then((c) => c.get(DEVICE_TZ_COOKIE)?.value ?? null);
}

/**
 * The single composition every authenticated section layout shares. The frame
 * and skeleton fallbacks are static (prerendered into the Cache Components
 * shell); the three per-user data slots stream in. NOT async, and it must stay
 * that way: nothing request-time may be awaited here or the static shell is
 * gone. Timezone, theme preset and device zone are all streamed as unawaited
 * promises so they never block the content area.
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
        <ThemePresetSync preset={resolveUserThemePreset()} />
      </Suspense>
      <DeviceTimeZoneProvider initial={resolveDeviceTimeZone()}>
        <TimeZoneProvider timeZone={resolveUserTimeZone()}>
          {children}
        </TimeZoneProvider>
      </DeviceTimeZoneProvider>
    </AppShell>
  );
}
