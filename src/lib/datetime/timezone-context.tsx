"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

/** The user's zone as an IANA id, or null = Automatic. It may still be an
 * unresolved promise streamed from the shell (the timezone read is not awaited
 * before content paints). */
type TimeZoneValue = string | null | Promise<string | null>;
const TimeZoneContext = createContext<TimeZoneValue>(null);

export function TimeZoneProvider({
  timeZone,
  children,
}: {
  timeZone: TimeZoneValue;
  children: ReactNode;
}) {
  return (
    <TimeZoneContext.Provider value={timeZone}>
      {children}
    </TimeZoneContext.Provider>
  );
}

/**
 * The zone to display an absolute timestamp in, resolved WITHOUT suspending:
 *   - an explicit personal zone (`profiles.timezone`) once the streamed promise
 *     resolves to a non-null string — this overrides the device zone;
 *   - otherwise `deviceZone` (the Automatic case — the device zone is what the
 *     user wants when they haven't pinned a zone).
 * Returns `null` only when both are unknown (first-ever visit, pre-mount, no
 * cookie) — the caller renders machine-readable-only text in that single case.
 * Never blanks, never flashes a wrong zone for Automatic users, and only ever
 * corrects device→explicit (rare: an explicit zone different from the device).
 */
export function useResolvedTimeZone(deviceZone: string | null): string | null {
  const v = useContext(TimeZoneContext);
  // Only the streamed-promise case needs state; a plain string/null is derived
  // during render. setState lives solely in the async `.then` callback, never
  // synchronously in the effect body (the repo's react-hooks lint rule).
  const [resolved, setResolved] = useState<string | null>(null);
  useEffect(() => {
    if (!v || typeof v !== "object" || !("then" in v)) return;
    let live = true;
    void v.then((z) => {
      if (live && typeof z === "string") setResolved(z);
    });
    return () => {
      live = false;
    };
  }, [v]);
  // Explicit personal zone wins: a plain string immediately, or the resolved
  // promise value once it lands. `null` (Automatic) falls through to the device
  // zone; both unknown → null (caller renders machine-readable-only text).
  const explicit = typeof v === "string" ? v : resolved;
  return explicit ?? deviceZone;
}
