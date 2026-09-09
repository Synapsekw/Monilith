"use client";

import {
  createContext,
  use,
  useContext,
  useEffect,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { detectDeviceTimeZone } from "@/lib/datetime/timezone";

/** Cookie the server reads to seed the device zone into streamed HTML. */
export const DEVICE_TZ_COOKIE = "pulse_tz";

/**
 * The server-read seed. It is normally an UNAWAITED promise: `AuthenticatedShell`
 * calls `cookies()` without awaiting so the `(app)` group keeps its prerendered
 * static shell (see the provider docblock). A plain string/null is still
 * accepted — that is the shape tests and any synchronous caller use.
 */
export type DeviceTimeZoneSeed = string | null | Promise<string | null>;

/** null = device zone not yet known (first-ever visit, pre-mount). */
const DeviceTimeZoneContext = createContext<DeviceTimeZoneSeed>(null);

/** The device zone has no external source of change — read once on the client. */
function subscribe(): () => void {
  return () => {};
}

/** Client snapshot: the real device zone (a stable string → Object.is-safe). */
function getDeviceZone(): string {
  return detectDeviceTimeZone();
}

function isPending(seed: DeviceTimeZoneSeed): seed is Promise<string | null> {
  return typeof seed === "object" && seed !== null && "then" in seed;
}

/** The cookie's current value, decoded, or null when it is not set. */
function readCookie(name: string): string | null {
  const hit = document.cookie.split("; ").find((c) => c.startsWith(`${name}=`));
  return hit ? decodeURIComponent(hit.slice(name.length + 1)) : null;
}

/**
 * Puts the server-read seed in context so returning visitors get correct
 * timestamps in the FIRST streamed HTML — no blank, no flash.
 *
 * This provider wraps EVERY authenticated page, which makes it the one place
 * in the tree that must never suspend: it sits above all four shell Suspense
 * boundaries, so awaiting (or `use`-ing) the seed here would make the whole
 * `(app)` group dynamic and leave the route with NO static shell — 0-byte
 * `.next/server/app/*.html`, nothing painted on a cold load. So the seed is
 * passed through untouched and resolved in the consumer instead
 * ({@link useDeviceTimeZone}), which is Next's "maximize the static shell"
 * pattern: call the runtime API unawaited, resolve it deeper in the tree.
 * `src/test/static-shell.test.ts` guards the shell side of this.
 *
 * The effect refreshes the cookie when the detected zone differs from what the
 * jar already holds (moved laptop, changed OS zone, first-ever visit). It
 * compares against the JAR rather than the seed precisely because the seed may
 * still be unresolved here — and the jar is the same value the server read. No
 * server round-trip.
 */
export function DeviceTimeZoneProvider({
  initial,
  children,
}: {
  initial: DeviceTimeZoneSeed;
  children: ReactNode;
}) {
  useEffect(() => {
    const zone = detectDeviceTimeZone();
    if (!zone || readCookie(DEVICE_TZ_COOKIE) === zone) return;
    document.cookie = `${DEVICE_TZ_COOKIE}=${encodeURIComponent(
      zone,
    )}; path=/; max-age=31536000; samesite=lax`;
  }, []);
  return (
    <DeviceTimeZoneContext.Provider value={initial}>
      {children}
    </DeviceTimeZoneContext.Provider>
  );
}

/**
 * The current device zone, or null if not yet known.
 *
 * `useSyncExternalStore` serves the seeded cookie value as the server/hydration
 * snapshot, then swaps to the real client-detected zone after hydration (the
 * codebase's `use-coarse-pointer` pattern — no setState-in-effect). Resolving
 * the streamed seed with React `use` happens HERE rather than in the provider:
 * only the consumer suspends, behind whatever boundary already covers it (the
 * sole consumer, `DateTime`, renders inside route content that is streamed
 * behind a `loading.tsx` fallback), so the shell above it still prerenders.
 * `use` is the one hook React permits to run conditionally.
 */
export function useDeviceTimeZone(): string | null {
  const seed = useContext(DeviceTimeZoneContext);
  const initial = isPending(seed) ? use(seed) : seed;
  return useSyncExternalStore<string | null>(
    subscribe,
    getDeviceZone,
    () => initial,
  );
}
