"use client";

import {
  createContext,
  useContext,
  useEffect,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { detectDeviceTimeZone } from "@/lib/datetime/timezone";

/** Cookie the server reads to seed the device zone into streamed HTML. */
export const DEVICE_TZ_COOKIE = "pulse_tz";

/** null = device zone not yet known (first-ever visit, pre-mount). */
const DeviceTimeZoneContext = createContext<string | null>(null);

/** The device zone has no external source of change — read once on the client. */
function subscribe(): () => void {
  return () => {};
}

/** Client snapshot: the real device zone (a stable string → Object.is-safe). */
function getDeviceZone(): string {
  return detectDeviceTimeZone();
}

/**
 * Seeds the device zone from a server-read cookie (`initial`) so returning
 * visitors get correct timestamps in the FIRST streamed HTML — no blank, no
 * flash. `useSyncExternalStore` uses the seed as the server/hydration snapshot,
 * then swaps to the real client-detected zone after hydration (the codebase's
 * `use-coarse-pointer` pattern — no setState-in-effect, never suspends). A
 * separate effect refreshes the cookie when the detected zone drifted from the
 * seed (moved laptop, changed OS zone). No server round-trip.
 */
export function DeviceTimeZoneProvider({
  initial,
  children,
}: {
  initial: string | null;
  children: ReactNode;
}) {
  const zone = useSyncExternalStore<string | null>(
    subscribe,
    getDeviceZone,
    () => initial,
  );
  useEffect(() => {
    if (zone && zone !== initial) {
      document.cookie = `${DEVICE_TZ_COOKIE}=${encodeURIComponent(
        zone,
      )}; path=/; max-age=31536000; samesite=lax`;
    }
  }, [zone, initial]);
  return (
    <DeviceTimeZoneContext.Provider value={zone}>
      {children}
    </DeviceTimeZoneContext.Provider>
  );
}

/** The current device zone, or null if not yet known. Never suspends. */
export function useDeviceTimeZone(): string | null {
  return useContext(DeviceTimeZoneContext);
}
